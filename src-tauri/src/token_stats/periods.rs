use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use std::collections::BTreeMap;

use super::models::{DailySessionTotals, StatsGranularity, TokenStatsBucket, TokenTotals};

#[derive(Debug)]
struct PeriodKey {
    key: String,
    label: String,
    range_start: DateTime<Tz>,
    range_end: DateTime<Tz>,
}

fn period_keys(granularity: StatsGranularity, now: DateTime<Tz>) -> Vec<PeriodKey> {
    let today = now.date_naive();
    match granularity {
        StatsGranularity::Day => (0..7)
            .rev()
            .map(|days_ago| {
                let date = today - Duration::days(days_ago);
                period_key(
                    date,
                    date + Duration::days(1),
                    date.format("%Y-%m-%d").to_string(),
                    date.format("%m-%d").to_string(),
                    now.timezone(),
                )
            })
            .collect(),
        StatsGranularity::Week => {
            let current_monday =
                today - Duration::days(today.weekday().num_days_from_monday().into());
            (0..12)
                .rev()
                .map(|weeks_ago| {
                    let start = current_monday - Duration::weeks(weeks_ago);
                    let iso_week = start.iso_week();
                    period_key(
                        start,
                        start + Duration::weeks(1),
                        format!("{}-W{:02}", iso_week.year(), iso_week.week()),
                        format!("W{:02}", iso_week.week()),
                        now.timezone(),
                    )
                })
                .collect()
        }
        StatsGranularity::Month => (1..=12)
            .map(|month| {
                let start = NaiveDate::from_ymd_opt(today.year(), month, 1)
                    .expect("calendar months are valid");
                let end = if month == 12 {
                    NaiveDate::from_ymd_opt(today.year() + 1, 1, 1)
                } else {
                    NaiveDate::from_ymd_opt(today.year(), month + 1, 1)
                }
                .expect("calendar months are valid");
                period_key(
                    start,
                    end,
                    start.format("%Y-%m").to_string(),
                    start.format("%b").to_string(),
                    now.timezone(),
                )
            })
            .collect(),
    }
}

pub(crate) fn build_buckets(
    daily: &DailySessionTotals,
    granularity: StatsGranularity,
    now: DateTime<Utc>,
    timezone: Tz,
) -> Vec<TokenStatsBucket> {
    let local_now = now.with_timezone(&timezone);
    let today = local_now.date_naive();

    period_keys(granularity, local_now)
        .into_iter()
        .map(|period| {
            let start = period.range_start.date_naive();
            let end = period.range_end.date_naive();
            let mut totals = TokenTotals::default();
            let mut sessions_by_path = BTreeMap::new();

            for sessions in daily.range(start..end).map(|(_, sessions)| sessions) {
                for (relative_path, session) in sessions {
                    add_totals(&mut totals, session);
                    add_totals(sessions_by_path.entry(relative_path).or_default(), session);
                }
            }
            let task_count = sessions_by_path
                .values()
                .filter(|session| session.total_tokens > 0)
                .count() as u64;
            let peak_task_tokens = sessions_by_path
                .values()
                .map(|session| session.total_tokens)
                .max()
                .unwrap_or_default();

            TokenStatsBucket {
                key: period.key,
                label: period.label,
                range_start: period.range_start.to_rfc3339(),
                range_end: period.range_end.to_rfc3339(),
                totals,
                task_count,
                peak_task_tokens,
                is_future: start > today,
            }
        })
        .collect()
}

fn add_totals(target: &mut TokenTotals, source: &TokenTotals) {
    target.total_tokens += source.total_tokens;
    target.input_tokens += source.input_tokens;
    target.cached_input_tokens += source.cached_input_tokens;
    target.output_tokens += source.output_tokens;
    target.reasoning_tokens += source.reasoning_tokens;
}

fn period_key(
    start: NaiveDate,
    end: NaiveDate,
    key: String,
    label: String,
    timezone: Tz,
) -> PeriodKey {
    PeriodKey {
        key,
        label,
        range_start: local_midnight(start, timezone),
        range_end: local_midnight(end, timezone),
    }
}

fn local_midnight(date: NaiveDate, timezone: Tz) -> DateTime<Tz> {
    let local = date
        .and_hms_opt(0, 0, 0)
        .expect("midnight is a valid naive time");
    match timezone.from_local_datetime(&local) {
        LocalResult::Single(value) | LocalResult::Ambiguous(value, _) => value,
        LocalResult::None => {
            for minutes in 1..=(24 * 60) {
                let candidate = local + Duration::minutes(minutes);
                if let Some(value) = timezone.from_local_datetime(&candidate).earliest() {
                    return value;
                }
            }
            unreachable!("a timezone must contain a local instant within one day")
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, path::PathBuf};

    use super::{build_buckets, period_keys};
    use crate::token_stats::models::{DailySessionTotals, StatsGranularity, TokenTotals};
    use chrono::{Datelike, TimeZone, Utc};

    #[test]
    fn day_week_and_month_counts_match_the_contract() {
        let tz: chrono_tz::Tz = "Asia/Shanghai".parse().unwrap();
        let now = tz.with_ymd_and_hms(2026, 7, 23, 14, 0, 0).unwrap();
        let day_keys = period_keys(StatsGranularity::Day, now);
        assert_eq!(day_keys.len(), 7);
        assert_eq!(day_keys.first().unwrap().key, "2026-07-17");
        assert_eq!(day_keys.last().unwrap().key, "2026-07-23");
        assert_eq!(period_keys(StatsGranularity::Week, now).len(), 12);
        assert_eq!(period_keys(StatsGranularity::Month, now).len(), 12);
    }

    #[test]
    fn iso_week_starts_on_monday_and_crosses_year_correctly() {
        let tz: chrono_tz::Tz = "Asia/Shanghai".parse().unwrap();
        let now = tz.with_ymd_and_hms(2027, 1, 1, 12, 0, 0).unwrap();
        let latest = period_keys(StatsGranularity::Week, now).pop().unwrap();
        assert_eq!(latest.label, "W53");
        assert_eq!(latest.range_start.weekday(), chrono::Weekday::Mon);
    }

    #[test]
    fn daylight_saving_transition_keeps_one_bucket_per_local_date() {
        let tz: chrono_tz::Tz = "America/Los_Angeles".parse().unwrap();
        let now = tz.with_ymd_and_hms(2026, 3, 9, 12, 0, 0).unwrap();
        let keys = period_keys(StatsGranularity::Day, now);
        assert_eq!(keys.len(), 7);
        assert_eq!(
            keys.iter()
                .map(|key| key.range_start.date_naive())
                .collect::<std::collections::HashSet<_>>()
                .len(),
            7
        );
    }

    #[test]
    fn empty_input_returns_zero_filled_buckets_and_marks_future_months() {
        let timezone: chrono_tz::Tz = "Asia/Shanghai".parse().unwrap();
        let now = timezone
            .with_ymd_and_hms(2026, 7, 23, 14, 0, 0)
            .unwrap()
            .with_timezone(&Utc);

        let day_buckets = build_buckets(
            &DailySessionTotals::new(),
            StatsGranularity::Day,
            now,
            timezone,
        );
        assert_eq!(day_buckets.len(), 7);
        assert!(day_buckets.iter().all(|bucket| {
            bucket.totals == TokenTotals::default()
                && bucket.task_count == 0
                && bucket.peak_task_tokens == 0
                && !bucket.is_future
        }));

        let month_buckets = build_buckets(
            &DailySessionTotals::new(),
            StatsGranularity::Month,
            now,
            timezone,
        );
        assert_eq!(month_buckets.len(), 12);
        assert!(month_buckets[..7].iter().all(|bucket| !bucket.is_future));
        assert!(month_buckets[7..].iter().all(|bucket| bucket.is_future));
    }

    #[test]
    fn reduction_sums_days_and_counts_each_positive_session_once() {
        let timezone: chrono_tz::Tz = "Asia/Shanghai".parse().unwrap();
        let now = timezone
            .with_ymd_and_hms(2026, 7, 23, 14, 0, 0)
            .unwrap()
            .with_timezone(&Utc);
        let mut daily = DailySessionTotals::new();
        daily.insert(
            chrono::NaiveDate::from_ymd_opt(2026, 7, 20).unwrap(),
            BTreeMap::from([
                (
                    PathBuf::from("2026/07/session-a.jsonl"),
                    TokenTotals {
                        total_tokens: 100,
                        input_tokens: 40,
                        cached_input_tokens: 20,
                        output_tokens: 30,
                        reasoning_tokens: 10,
                    },
                ),
                (PathBuf::from("2026/07/empty.jsonl"), TokenTotals::default()),
            ]),
        );
        daily.insert(
            chrono::NaiveDate::from_ymd_opt(2026, 7, 22).unwrap(),
            BTreeMap::from([(
                PathBuf::from("2026/07/session-b.jsonl"),
                TokenTotals {
                    total_tokens: 250,
                    input_tokens: 120,
                    cached_input_tokens: 40,
                    output_tokens: 60,
                    reasoning_tokens: 30,
                },
            )]),
        );

        let buckets = build_buckets(&daily, StatsGranularity::Week, now, timezone);
        let current = buckets.last().unwrap();
        assert_eq!(
            current.totals,
            TokenTotals {
                total_tokens: 350,
                input_tokens: 160,
                cached_input_tokens: 60,
                output_tokens: 90,
                reasoning_tokens: 40,
            }
        );
        assert_eq!(current.task_count, 2);
        assert_eq!(current.peak_task_tokens, 250);
    }

    #[test]
    fn repeated_session_path_across_dates_counts_once_and_combines_peak() {
        let timezone: chrono_tz::Tz = "Asia/Shanghai".parse().unwrap();
        let now = timezone
            .with_ymd_and_hms(2026, 7, 23, 14, 0, 0)
            .unwrap()
            .with_timezone(&Utc);
        let relative_path = PathBuf::from("2026/07/session-spanning-midnight.jsonl");
        let mut daily = DailySessionTotals::new();
        daily.insert(
            chrono::NaiveDate::from_ymd_opt(2026, 7, 20).unwrap(),
            BTreeMap::from([(
                relative_path.clone(),
                TokenTotals {
                    total_tokens: 100,
                    ..TokenTotals::default()
                },
            )]),
        );
        daily.insert(
            chrono::NaiveDate::from_ymd_opt(2026, 7, 22).unwrap(),
            BTreeMap::from([(
                relative_path,
                TokenTotals {
                    total_tokens: 250,
                    ..TokenTotals::default()
                },
            )]),
        );

        let buckets = build_buckets(&daily, StatsGranularity::Week, now, timezone);
        let current = buckets.last().unwrap();
        assert_eq!(current.task_count, 1);
        assert_eq!(current.peak_task_tokens, 350);
    }
}
