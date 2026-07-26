use std::{
    collections::BTreeMap,
    io::{self, BufRead},
};

use chrono::{DateTime, NaiveDate};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};

use super::models::TokenTotals;

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ParserState {
    previous_total: TokenTotals,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct ParsedContribution {
    pub(crate) total: TokenTotals,
    pub(crate) daily: BTreeMap<NaiveDate, TokenTotals>,
    pub(crate) skipped_records: u64,
    pub(crate) ignored_records: u64,
    pub(crate) malformed_records: u64,
    pub(crate) integrity_errors: u64,
    pub(crate) overflowed: bool,
    pub(crate) consumed_bytes: u64,
    pub(crate) trailing_incomplete: bool,
}

#[derive(Deserialize)]
struct LogEnvelope {
    timestamp: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
    payload: Option<TokenPayload>,
}

#[derive(Deserialize)]
struct TokenPayload {
    #[serde(rename = "type")]
    kind: Option<String>,
    info: Option<TokenInfo>,
}

#[derive(Deserialize)]
struct TokenInfo {
    total_token_usage: Option<RawTotals>,
    last_token_usage: Option<RawTotals>,
}

#[derive(Deserialize)]
struct RawTotals {
    total_tokens: Option<u64>,
    input_tokens: Option<u64>,
    cached_input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    reasoning_output_tokens: Option<u64>,
}

enum RecordOutcome {
    Contribution(DateTime<chrono::FixedOffset>, TokenTotals),
    Ignored,
    Malformed,
}

enum SkippedKind {
    Ignored,
    Malformed,
}

pub(crate) fn parse_jsonl<R: BufRead>(
    mut reader: R,
    state: &mut ParserState,
    timezone: Tz,
) -> io::Result<ParsedContribution> {
    let mut contribution = ParsedContribution::default();
    let mut next_state = *state;
    let mut line = Vec::new();

    loop {
        line.clear();
        let bytes_read = reader.read_until(b'\n', &mut line)?;
        if bytes_read == 0 {
            break;
        }
        if !line.ends_with(b"\n") {
            contribution.trailing_incomplete = true;
            break;
        }
        contribution.consumed_bytes = contribution
            .consumed_bytes
            .checked_add(
                u64::try_from(bytes_read)
                    .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "record too large"))?,
            )
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "consumed byte count overflow")
            })?;

        line.pop();
        if line.ends_with(b"\r") {
            line.pop();
        }
        let Ok(line) = std::str::from_utf8(&line) else {
            record_skipped(&mut contribution, SkippedKind::Malformed);
            continue;
        };
        if line.trim().is_empty() {
            continue;
        }

        let (timestamp, current) = match parse_record(line) {
            RecordOutcome::Contribution(timestamp, current) => (timestamp, current),
            RecordOutcome::Ignored => {
                record_skipped(&mut contribution, SkippedKind::Ignored);
                continue;
            }
            RecordOutcome::Malformed => {
                record_skipped(&mut contribution, SkippedKind::Malformed);
                continue;
            }
        };

        let record_delta = totals_delta(current, next_state.previous_total);
        next_state.previous_total = current;
        let aggregate_overflowed = add_totals(&mut contribution.total, record_delta);
        let daily_overflowed = add_totals(
            contribution
                .daily
                .entry(timestamp.with_timezone(&timezone).date_naive())
                .or_default(),
            record_delta,
        );
        if aggregate_overflowed || daily_overflowed {
            record_overflow(&mut contribution);
        }
    }

    *state = next_state;
    Ok(contribution)
}

fn parse_record(line: &str) -> RecordOutcome {
    let Ok(envelope) = serde_json::from_str::<LogEnvelope>(line) else {
        return RecordOutcome::Malformed;
    };
    match envelope.kind.as_deref() {
        Some("event_msg") => {}
        Some(_) => return RecordOutcome::Ignored,
        None => return RecordOutcome::Malformed,
    }

    let Some(payload) = envelope.payload else {
        return RecordOutcome::Malformed;
    };
    match payload.kind.as_deref() {
        Some("token_count") => {}
        Some(_) => return RecordOutcome::Ignored,
        None => return RecordOutcome::Malformed,
    }

    let Some(timestamp) = envelope
        .timestamp
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
    else {
        return RecordOutcome::Malformed;
    };
    let Some(info) = payload.info else {
        return RecordOutcome::Malformed;
    };
    let Some(current) = info.total_token_usage.and_then(RawTotals::into_totals) else {
        return RecordOutcome::Malformed;
    };
    let _diagnostic_last_usage = info.last_token_usage;
    RecordOutcome::Contribution(timestamp, current)
}

impl RawTotals {
    fn into_totals(self) -> Option<TokenTotals> {
        Some(TokenTotals {
            total_tokens: self.total_tokens?,
            input_tokens: self.input_tokens?,
            cached_input_tokens: self.cached_input_tokens?,
            output_tokens: self.output_tokens?,
            reasoning_tokens: self.reasoning_output_tokens?,
        })
    }
}

fn totals_delta(current: TokenTotals, previous: TokenTotals) -> TokenTotals {
    TokenTotals {
        total_tokens: delta(current.total_tokens, previous.total_tokens),
        input_tokens: delta(current.input_tokens, previous.input_tokens),
        cached_input_tokens: delta(current.cached_input_tokens, previous.cached_input_tokens),
        output_tokens: delta(current.output_tokens, previous.output_tokens),
        reasoning_tokens: delta(current.reasoning_tokens, previous.reasoning_tokens),
    }
}

fn delta(current: u64, previous: u64) -> u64 {
    if current >= previous {
        current - previous
    } else {
        current
    }
}

fn add_totals(target: &mut TokenTotals, source: TokenTotals) -> bool {
    let mut overflowed = false;
    overflowed |= add_field(&mut target.total_tokens, source.total_tokens);
    overflowed |= add_field(&mut target.input_tokens, source.input_tokens);
    overflowed |= add_field(&mut target.cached_input_tokens, source.cached_input_tokens);
    overflowed |= add_field(&mut target.output_tokens, source.output_tokens);
    overflowed |= add_field(&mut target.reasoning_tokens, source.reasoning_tokens);
    overflowed
}

fn add_field(target: &mut u64, source: u64) -> bool {
    if let Some(total) = target.checked_add(source) {
        *target = total;
        false
    } else {
        *target = u64::MAX;
        true
    }
}

fn record_skipped(contribution: &mut ParsedContribution, kind: SkippedKind) {
    let mut overflowed = increment(&mut contribution.skipped_records);
    overflowed |= match kind {
        SkippedKind::Ignored => increment(&mut contribution.ignored_records),
        SkippedKind::Malformed => increment(&mut contribution.malformed_records),
    };
    if overflowed {
        record_overflow(contribution);
    }
}

fn record_overflow(contribution: &mut ParsedContribution) {
    contribution.overflowed = true;
    increment(&mut contribution.integrity_errors);
}

fn increment(counter: &mut u64) -> bool {
    if let Some(next) = counter.checked_add(1) {
        *counter = next;
        false
    } else {
        *counter = u64::MAX;
        true
    }
}

#[cfg(test)]
mod tests {
    use std::io::{self, BufReader, Cursor, Read};

    use chrono::NaiveDate;
    use chrono_tz::Tz;

    use super::{parse_jsonl, ParsedContribution, ParserState};
    use crate::token_stats::models::TokenTotals;

    const RECORDS: &str = r#"
{"timestamp":"2026-07-23T01:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5,"total_tokens":125}}}}
{"timestamp":"2026-07-23T01:05:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":160,"cached_input_tokens":70,"output_tokens":35,"reasoning_output_tokens":8,"total_tokens":203},"last_token_usage":{"total_tokens":78}}}}
"#;

    struct FailAfterChunk {
        chunk: Cursor<Vec<u8>>,
    }

    impl Read for FailAfterChunk {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if self.chunk.position() < self.chunk.get_ref().len() as u64 {
                self.chunk.read(buffer)
            } else {
                Err(io::Error::new(io::ErrorKind::Other, "injected failure"))
            }
        }
    }

    fn parse_text(text: &str, timezone: &str) -> ParsedContribution {
        let timezone: Tz = timezone.parse().unwrap();
        parse_jsonl(
            Cursor::new(text.as_bytes()),
            &mut ParserState::default(),
            timezone,
        )
        .unwrap()
    }

    #[test]
    fn cumulative_records_produce_only_the_non_negative_delta() {
        let result = parse_text(RECORDS, "Asia/Shanghai");

        assert_eq!(result.total.total_tokens, 203);
        assert_eq!(result.total.input_tokens, 160);
        assert_eq!(result.total.cached_input_tokens, 70);
        assert_eq!(result.total.output_tokens, 35);
        assert_eq!(result.total.reasoning_tokens, 8);
    }

    #[test]
    fn last_usage_is_not_added_again() {
        let result = parse_text(RECORDS, "Asia/Shanghai");

        assert_ne!(result.total.total_tokens, 281);
    }

    #[test]
    fn decreasing_fields_reset_independently() {
        let records = r#"
{"timestamp":"2026-07-23T01:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":50,"output_tokens":20,"reasoning_output_tokens":10,"total_tokens":180}}}}
{"timestamp":"2026-07-23T01:05:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":25,"cached_input_tokens":60,"output_tokens":5,"reasoning_output_tokens":12,"total_tokens":42}}}}
"#;

        let result = parse_text(records, "UTC");

        assert_eq!(
            result.total,
            TokenTotals {
                total_tokens: 222,
                input_tokens: 125,
                cached_input_tokens: 60,
                output_tokens: 25,
                reasoning_tokens: 12,
            }
        );
    }

    #[test]
    fn state_carries_cumulative_values_across_append_scans() {
        let timezone: Tz = "UTC".parse().unwrap();
        let mut state = ParserState::default();
        parse_jsonl(
            Cursor::new(
                br#"{"timestamp":"2026-07-23T01:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5,"total_tokens":125}}}}
"#,
            ),
            &mut state,
            timezone,
        )
        .unwrap();

        let appended = parse_jsonl(
            Cursor::new(
                br#"{"timestamp":"2026-07-23T01:05:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":160,"cached_input_tokens":70,"output_tokens":35,"reasoning_output_tokens":8,"total_tokens":203}}}}
"#,
            ),
            &mut state,
            timezone,
        )
        .unwrap();

        assert_eq!(
            appended.total,
            TokenTotals {
                total_tokens: 78,
                input_tokens: 60,
                cached_input_tokens: 30,
                output_tokens: 15,
                reasoning_tokens: 3,
            }
        );
    }

    #[test]
    fn trailing_fragment_waits_for_newline_and_is_parsed_exactly_once() {
        let timezone: Tz = "UTC".parse().unwrap();
        let mut state = ParserState::default();
        let partial = br#"{"timestamp":"2026-07-23T01:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5,"total_tokens":"#;
        let completed = br#"{"timestamp":"2026-07-23T01:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5,"total_tokens":125}}}}
"#;

        let first = parse_jsonl(Cursor::new(partial), &mut state, timezone).unwrap();
        assert_eq!(first.total, TokenTotals::default());
        assert_eq!(first.consumed_bytes, 0);
        assert!(first.trailing_incomplete);

        let second = parse_jsonl(Cursor::new(completed), &mut state, timezone).unwrap();
        assert_eq!(second.total.total_tokens, 125);
        assert_eq!(second.consumed_bytes, completed.len() as u64);
        assert!(!second.trailing_incomplete);
    }

    #[test]
    fn io_failure_leaves_caller_state_atomic() {
        let timezone: Tz = "UTC".parse().unwrap();
        let mut state = ParserState::default();
        let initial = br#"{"timestamp":"2026-07-23T01:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5,"total_tokens":125}}}}
"#;
        let appended = br#"{"timestamp":"2026-07-23T01:05:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":160,"cached_input_tokens":70,"output_tokens":35,"reasoning_output_tokens":8,"total_tokens":203}}}}
"#;
        parse_jsonl(Cursor::new(initial), &mut state, timezone).unwrap();
        let state_before_failure = state;
        let failing_reader = BufReader::new(FailAfterChunk {
            chunk: Cursor::new(appended.to_vec()),
        });

        let failed = parse_jsonl(failing_reader, &mut state, timezone);

        assert!(failed.is_err());
        assert_eq!(state, state_before_failure);
        let retry = parse_jsonl(Cursor::new(appended), &mut state, timezone).unwrap();
        assert_eq!(retry.total.total_tokens, 78);
    }

    #[test]
    fn malformed_and_missing_required_fields_are_counted_without_contribution() {
        let records = r#"
not json
{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":10}}}}
{"timestamp":"2026-07-23T01:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{}}}
"#;

        let result = parse_text(records, "UTC");

        assert_eq!(result.total, TokenTotals::default());
        assert!(result.daily.is_empty());
        assert_eq!(result.skipped_records, 3);
        assert_eq!(result.malformed_records, 3);
        assert_eq!(result.ignored_records, 0);
    }

    #[test]
    fn contributions_are_attributed_across_local_midnight() {
        let records = r#"
{"timestamp":"2026-07-22T15:59:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"cached_input_tokens":30,"output_tokens":15,"reasoning_output_tokens":5,"total_tokens":100}}}}
{"timestamp":"2026-07-22T16:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":120,"cached_input_tokens":40,"output_tokens":25,"reasoning_output_tokens":10,"total_tokens":155}}}}
"#;

        let result = parse_text(records, "Asia/Shanghai");

        assert_eq!(
            result
                .daily
                .get(&NaiveDate::from_ymd_opt(2026, 7, 22).unwrap())
                .unwrap()
                .total_tokens,
            100
        );
        assert_eq!(
            result
                .daily
                .get(&NaiveDate::from_ymd_opt(2026, 7, 23).unwrap())
                .unwrap()
                .total_tokens,
            55
        );
    }

    #[test]
    fn unrelated_events_contribute_zero_and_are_counted() {
        let records = r#"
{"timestamp":"2026-07-23T01:00:00Z","type":"response_item","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":100}}}}
{"timestamp":"2026-07-23T01:00:00Z","type":"event_msg","payload":{"type":"message","message":"private text"}}
"#;

        let result = parse_text(records, "UTC");

        assert_eq!(result.total, TokenTotals::default());
        assert_eq!(result.skipped_records, 2);
        assert_eq!(result.malformed_records, 0);
        assert_eq!(result.ignored_records, 2);
    }

    #[test]
    fn overflow_sets_integrity_diagnostic() {
        let records = r#"
{"timestamp":"2026-07-23T01:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":18446744073709551615,"cached_input_tokens":18446744073709551615,"output_tokens":18446744073709551615,"reasoning_output_tokens":18446744073709551615,"total_tokens":18446744073709551615}}}}
{"timestamp":"2026-07-23T01:05:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"cached_input_tokens":1,"output_tokens":1,"reasoning_output_tokens":1,"total_tokens":1}}}}
"#;

        let result = parse_text(records, "UTC");

        assert_eq!(result.total.total_tokens, u64::MAX);
        assert!(result.overflowed);
        assert_eq!(result.integrity_errors, 1);
    }

    #[test]
    fn parser_state_round_trips_as_numeric_totals_only() {
        let timezone: Tz = "UTC".parse().unwrap();
        let mut state = ParserState::default();
        parse_jsonl(Cursor::new(RECORDS.as_bytes()), &mut state, timezone).unwrap();

        let serialized = serde_json::to_string(&state).unwrap();
        let restored: ParserState = serde_json::from_str(&serialized).unwrap();

        assert_eq!(restored, state);
        assert!(serialized.contains("\"previousTotal\""));
        assert!(!serialized.contains("timestamp"));
        assert!(!serialized.contains("payload"));
    }
}
