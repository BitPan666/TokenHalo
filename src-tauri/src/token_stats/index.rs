use std::{
    collections::{BTreeMap, HashMap, HashSet},
    ffi::OsStr,
    fs::{self, File, Metadata},
    io::{self, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use chrono::NaiveDate;
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use super::{
    models::{DailySessionTotals, TokenTotals},
    parser::{parse_jsonl, ParserState},
};

pub(crate) const INDEX_VERSION: u32 = 2;
const BOUNDARY_WINDOW_BYTES: u64 = 4 * 1024;
const FINGERPRINT_OFFSET: u64 = 0xcbf29ce484222325;
const FINGERPRINT_PRIME: u64 = 0x100000001b3;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct TokenStatsIndex {
    pub(crate) version: u32,
    pub(crate) files: HashMap<String, IndexedSession>,
    pub(crate) partial: bool,
    #[serde(default)]
    pub(crate) timezone: Option<String>,
}

impl Default for TokenStatsIndex {
    fn default() -> Self {
        Self {
            version: INDEX_VERSION,
            files: HashMap::new(),
            partial: false,
            timezone: None,
        }
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub(crate) struct IndexedSession {
    pub(crate) len: u64,
    pub(crate) modified_nanos: u128,
    pub(crate) cursor: u64,
    pub(crate) parser_state: ParserState,
    pub(crate) by_day: BTreeMap<NaiveDate, TokenTotals>,
    #[serde(default)]
    file_identity: Option<FileIdentity>,
    #[serde(default)]
    change_marker: Option<ChangeMarker>,
    #[serde(default)]
    boundary_fingerprint: u64,
    #[serde(default)]
    boundary_len: u32,
    #[serde(default)]
    partial: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
struct FileIdentity {
    device: u64,
    inode: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
struct ChangeMarker {
    seconds: i64,
    nanos: i64,
}

#[derive(Debug, Clone, Copy)]
struct FileStamp {
    len: u64,
    modified_nanos: u128,
    identity: Option<FileIdentity>,
    change_marker: Option<ChangeMarker>,
}

impl TokenStatsIndex {
    pub(crate) fn scan(&mut self, root: &Path, timezone: Tz) -> io::Result<DailySessionTotals> {
        let root_metadata = match fs::metadata(root) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                self.reset(timezone);
                return Ok(DailySessionTotals::new());
            }
            Err(error) => return Err(error),
        };
        if !root_metadata.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                "session root is not a directory",
            ));
        }
        let discovered = discover_jsonl(root)?;
        let timezone_name = timezone.to_string();
        if self.version != INDEX_VERSION || self.timezone.as_deref() != Some(&timezone_name) {
            self.reset(timezone);
        }
        let seen: HashSet<String> = discovered.iter().map(|(key, _)| key.clone()).collect();
        let mut skipped_file = false;

        for (key, path) in discovered {
            if let Err(_error) = self.scan_file(&key, &path, timezone) {
                skipped_file = true;
            }
        }

        self.files.retain(|key, _| seen.contains(key));
        self.partial = skipped_file || self.files.values().any(|session| session.partial);
        Ok(self.daily_totals())
    }

    fn reset(&mut self, timezone: Tz) {
        self.version = INDEX_VERSION;
        self.files.clear();
        self.partial = false;
        self.timezone = Some(timezone.to_string());
    }

    fn scan_file(&mut self, key: &str, path: &Path, timezone: Tz) -> io::Result<()> {
        let mut file = File::open(path)?;
        let before = file.metadata()?;
        let before = file_stamp(&before)?;

        let append_from = match self.files.get(key) {
            Some(session) if unchanged_file(session, before) => {
                return Ok(());
            }
            Some(session) if append_candidate(session, before) => {
                append_cursor(&mut file, session, before.len, before.modified_nanos)?
            }
            Some(_) | None => None,
        };

        if let Some(cursor) = append_from {
            let previous = self.files.get(key).cloned().unwrap_or_default();
            let updated = parse_open_file(file, timezone, cursor, previous, false, before)?;
            self.files.insert(key.to_owned(), updated);
        } else {
            let rebuilt =
                parse_open_file(file, timezone, 0, IndexedSession::default(), true, before)?;
            self.files.insert(key.to_owned(), rebuilt);
        }
        Ok(())
    }

    fn daily_totals(&self) -> DailySessionTotals {
        let mut daily = DailySessionTotals::new();
        for (relative_path, session) in &self.files {
            for (date, totals) in &session.by_day {
                daily
                    .entry(*date)
                    .or_default()
                    .insert(PathBuf::from(relative_path), *totals);
            }
        }
        daily
    }
}

fn discover_jsonl(root: &Path) -> io::Result<Vec<(String, PathBuf)>> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root) {
        let entry = entry.map_err(io::Error::other)?;
        if !entry.file_type().is_file() || entry.path().extension() != Some(OsStr::new("jsonl")) {
            continue;
        }
        let relative = entry.path().strip_prefix(root).map_err(io::Error::other)?;
        let Some(key) = relative.to_str() else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "session path is not valid UTF-8",
            ));
        };
        files.push((key.to_owned(), entry.into_path()));
    }
    files.sort_unstable_by(|left, right| left.0.cmp(&right.0));
    Ok(files)
}

fn append_cursor<R: Read + Seek>(
    reader: &mut R,
    session: &IndexedSession,
    current_len: u64,
    current_modified_nanos: u128,
) -> io::Result<Option<u64>> {
    if session.cursor > session.len || session.len > current_len {
        return Ok(None);
    }
    if current_len == session.len && current_modified_nanos == session.modified_nanos {
        return Ok(Some(session.cursor));
    }
    if current_len <= session.len || session.boundary_len == 0 {
        return Ok(None);
    }
    let (fingerprint, sample_len) = fingerprint_boundary(reader, session.cursor)?;
    Ok(
        (sample_len == session.boundary_len && fingerprint == session.boundary_fingerprint)
            .then_some(session.cursor),
    )
}

fn parse_open_file(
    mut file: File,
    timezone: Tz,
    cursor: u64,
    mut session: IndexedSession,
    rebuilding: bool,
    before: FileStamp,
) -> io::Result<IndexedSession> {
    file.seek(SeekFrom::Start(cursor))?;
    let mut parser_state = session.parser_state;
    let contribution = parse_jsonl(BufReader::new(&mut file), &mut parser_state, timezone)?;
    let next_cursor = cursor
        .checked_add(contribution.consumed_bytes)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "session cursor overflow"))?;
    let (boundary_fingerprint, boundary_len) = fingerprint_boundary(&mut file, next_cursor)?;
    let after = file_stamp(&file.metadata()?)?;
    if before.identity != after.identity || next_cursor > after.len {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "session changed while it was being scanned",
        ));
    }
    if !contribution.trailing_incomplete && next_cursor != after.len {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "session grew while it was being scanned",
        ));
    }

    if rebuilding {
        session.by_day.clear();
        session.partial = false;
    }
    let mut aggregate_overflowed = false;
    for (date, totals) in contribution.daily {
        aggregate_overflowed |= session
            .by_day
            .entry(date)
            .or_default()
            .saturating_add_assign(totals);
    }
    session.partial |= contribution.malformed_records > 0
        || contribution.integrity_errors > 0
        || contribution.overflowed
        || aggregate_overflowed;
    session.len = after.len;
    session.modified_nanos = after.modified_nanos;
    session.cursor = next_cursor;
    session.parser_state = parser_state;
    session.file_identity = after.identity;
    session.change_marker = after.change_marker;
    session.boundary_fingerprint = boundary_fingerprint;
    session.boundary_len = boundary_len;
    Ok(session)
}

fn modified_nanos(metadata: &Metadata) -> io::Result<u128> {
    metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn file_stamp(metadata: &Metadata) -> io::Result<FileStamp> {
    Ok(FileStamp {
        len: metadata.len(),
        modified_nanos: modified_nanos(metadata)?,
        identity: file_identity(metadata),
        change_marker: change_marker(metadata),
    })
}

fn unchanged_file(session: &IndexedSession, current: FileStamp) -> bool {
    session.len == current.len
        && session.modified_nanos == current.modified_nanos
        && session.file_identity == current.identity
        && session.change_marker == current.change_marker
}

fn append_candidate(session: &IndexedSession, current: FileStamp) -> bool {
    session.cursor <= session.len
        && current.len > session.len
        && session.file_identity == current.identity
}

#[cfg(unix)]
fn file_identity(metadata: &Metadata) -> Option<FileIdentity> {
    use std::os::unix::fs::MetadataExt;

    Some(FileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(not(unix))]
fn file_identity(_metadata: &Metadata) -> Option<FileIdentity> {
    None
}

#[cfg(unix)]
fn change_marker(metadata: &Metadata) -> Option<ChangeMarker> {
    use std::os::unix::fs::MetadataExt;

    Some(ChangeMarker {
        seconds: metadata.ctime(),
        nanos: metadata.ctime_nsec(),
    })
}

#[cfg(not(unix))]
fn change_marker(_metadata: &Metadata) -> Option<ChangeMarker> {
    None
}

fn fingerprint_boundary<R: Read + Seek>(reader: &mut R, cursor: u64) -> io::Result<(u64, u32)> {
    let sample_len = cursor.min(BOUNDARY_WINDOW_BYTES);
    reader.seek(SeekFrom::Start(cursor - sample_len))?;
    let mut reader = reader.take(sample_len);
    let mut fingerprint = FINGERPRINT_OFFSET;
    let mut buffer = [0_u8; BOUNDARY_WINDOW_BYTES as usize];
    let mut read_total = 0_u64;
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        read_total = read_total
            .checked_add(u64::try_from(read).map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidData, "fingerprint length overflow")
            })?)
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "fingerprint length overflow")
            })?;
        for byte in &buffer[..read] {
            fingerprint ^= u64::from(*byte);
            fingerprint = fingerprint.wrapping_mul(FINGERPRINT_PRIME);
        }
    }
    if read_total != sample_len {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "session changed while it was being fingerprinted",
        ));
    }
    Ok((
        fingerprint,
        u32::try_from(sample_len)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "boundary length overflow"))?,
    ))
}

#[cfg(test)]
mod tests {
    use std::{
        fs::{self, File, OpenOptions},
        io::{self, Cursor, Read, Seek, SeekFrom, Write},
        path::Path,
    };

    use chrono::NaiveDate;
    use chrono_tz::Tz;
    use tempfile::tempdir;

    use super::{
        append_cursor, file_stamp, fingerprint_boundary, parse_open_file, unchanged_file,
        ChangeMarker, FileIdentity, FileStamp, IndexedSession, TokenStatsIndex,
    };
    use crate::token_stats::models::{DailySessionTotals, TokenTotals};
    use crate::token_stats::parser::parse_jsonl;

    struct CountingReader {
        inner: Cursor<Vec<u8>>,
        bytes_read: u64,
    }

    impl CountingReader {
        fn new(bytes: Vec<u8>) -> Self {
            Self {
                inner: Cursor::new(bytes),
                bytes_read: 0,
            }
        }
    }

    impl Read for CountingReader {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            let read = self.inner.read(buffer)?;
            self.bytes_read += read as u64;
            Ok(read)
        }
    }

    impl Seek for CountingReader {
        fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
            self.inner.seek(position)
        }
    }

    fn record(timestamp: &str, totals: TokenTotals) -> String {
        serde_json::json!({
            "timestamp": timestamp,
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": totals.input_tokens,
                        "cached_input_tokens": totals.cached_input_tokens,
                        "output_tokens": totals.output_tokens,
                        "reasoning_output_tokens": totals.reasoning_tokens,
                        "total_tokens": totals.total_tokens,
                    }
                }
            }
        })
        .to_string()
            + "\n"
    }

    fn totals(total_tokens: u64) -> TokenTotals {
        TokenTotals {
            total_tokens,
            input_tokens: total_tokens,
            cached_input_tokens: 0,
            output_tokens: 0,
            reasoning_tokens: 0,
        }
    }

    fn day_total(daily: &DailySessionTotals, date: NaiveDate, path: &Path) -> TokenTotals {
        *daily
            .get(&date)
            .and_then(|sessions| sessions.get(path))
            .expect("indexed daily session")
    }

    fn utc() -> Tz {
        "UTC".parse().unwrap()
    }

    #[test]
    fn unchanged_metadata_match_reads_zero_file_content_bytes() {
        let history = "{}\n".repeat(32 * 1024).into_bytes();
        let mut reader = CountingReader::new(history.clone());
        let (boundary_fingerprint, boundary_len) =
            fingerprint_boundary(&mut reader, history.len() as u64).unwrap();
        reader.bytes_read = 0;
        let session = IndexedSession {
            len: history.len() as u64,
            modified_nanos: 42,
            cursor: history.len() as u64,
            boundary_fingerprint,
            boundary_len,
            ..IndexedSession::default()
        };
        let current = FileStamp {
            len: session.len,
            modified_nanos: session.modified_nanos,
            identity: Some(FileIdentity {
                device: 7,
                inode: 11,
            }),
            change_marker: Some(ChangeMarker {
                seconds: 13,
                nanos: 17,
            }),
        };
        let mut session = session;
        session.file_identity = current.identity;
        session.change_marker = current.change_marker;

        assert!(unchanged_file(&session, current));
        if !unchanged_file(&session, current) {
            let _ =
                append_cursor(&mut reader, &session, current.len, current.modified_nanos).unwrap();
        }

        assert_eq!(reader.bytes_read, 0);
    }

    #[test]
    fn append_validation_and_parse_do_not_reread_committed_history() {
        const MAX_BOUNDED_FINGERPRINT_BYTES: u64 = 2 * 4 * 1024;
        let history = "{}\n".repeat(32 * 1024).into_bytes();
        let appended = record("2026-07-23T01:05:00Z", totals(203)).into_bytes();
        let mut reader = CountingReader::new(history.clone());
        let (boundary_fingerprint, boundary_len) =
            fingerprint_boundary(&mut reader, history.len() as u64).unwrap();
        reader.inner.get_mut().extend_from_slice(&appended);
        reader.bytes_read = 0;
        let session = IndexedSession {
            len: history.len() as u64,
            modified_nanos: 42,
            cursor: history.len() as u64,
            boundary_fingerprint,
            boundary_len,
            ..IndexedSession::default()
        };

        let cursor = append_cursor(
            &mut reader,
            &session,
            (history.len() + appended.len()) as u64,
            43,
        )
        .unwrap()
        .expect("same file append");
        reader.seek(SeekFrom::Start(cursor)).unwrap();
        let mut parser_state = session.parser_state;
        let contribution = parse_jsonl(
            std::io::BufReader::new(&mut reader),
            &mut parser_state,
            utc(),
        )
        .unwrap();
        let next_cursor = cursor + contribution.consumed_bytes;
        let _next_boundary = fingerprint_boundary(&mut reader, next_cursor).unwrap();

        assert_eq!(contribution.total, totals(203));
        assert!(
            reader.bytes_read <= MAX_BOUNDED_FINGERPRINT_BYTES + appended.len() as u64,
            "read {} bytes for a {}-byte suffix",
            reader.bytes_read,
            appended.len()
        );
    }

    #[test]
    fn recursively_discovers_jsonl_with_relative_keys_and_is_idempotent() {
        let directory = tempdir().unwrap();
        let nested = directory.path().join("2026/07");
        fs::create_dir_all(&nested).unwrap();
        fs::write(
            nested.join("session.jsonl"),
            record("2026-07-23T01:00:00Z", totals(125)),
        )
        .unwrap();
        fs::write(
            nested.join("ignored.txt"),
            record("2026-07-23T01:00:00Z", totals(999)),
        )
        .unwrap();
        let mut index = TokenStatsIndex::default();
        let date = NaiveDate::from_ymd_opt(2026, 7, 23).unwrap();

        let first = index.scan(directory.path(), utc()).unwrap();
        let second = index.scan(directory.path(), utc()).unwrap();

        assert_eq!(
            day_total(&first, date, Path::new("2026/07/session.jsonl")),
            totals(125)
        );
        assert_eq!(second, first);
        assert_eq!(index.files.len(), 1);
        assert!(index.files.contains_key("2026/07/session.jsonl"));
        assert!(!index.partial);
    }

    #[test]
    fn append_scan_adds_only_the_cumulative_delta() {
        let directory = tempdir().unwrap();
        let session = directory.path().join("session.jsonl");
        fs::write(&session, record("2026-07-23T01:00:00Z", totals(125))).unwrap();
        let mut index = TokenStatsIndex::default();
        index.scan(directory.path(), utc()).unwrap();

        OpenOptions::new()
            .append(true)
            .open(&session)
            .unwrap()
            .write_all(record("2026-07-23T01:05:00Z", totals(203)).as_bytes())
            .unwrap();
        let daily = index.scan(directory.path(), utc()).unwrap();

        assert_eq!(
            day_total(
                &daily,
                NaiveDate::from_ymd_opt(2026, 7, 23).unwrap(),
                Path::new("session.jsonl"),
            ),
            totals(203)
        );
        assert_eq!(
            index.files["session.jsonl"].cursor,
            fs::metadata(session).unwrap().len()
        );
    }

    #[test]
    fn same_length_rewrite_with_matching_length_mtime_and_identity_uses_change_marker() {
        let directory = tempdir().unwrap();
        let session = directory.path().join("session.jsonl");
        let initial = record("2026-07-23T01:00:00Z", totals(125));
        let replacement = record("2026-07-24T01:00:00Z", totals(456));
        assert_eq!(initial.len(), replacement.len());
        fs::write(&session, initial).unwrap();
        let mut index = TokenStatsIndex::default();
        index.scan(directory.path(), utc()).unwrap();

        fs::write(&session, replacement).unwrap();
        let replacement_metadata = fs::metadata(&session).unwrap();
        let replacement_stamp = file_stamp(&replacement_metadata).unwrap();
        let indexed = index.files.get_mut("session.jsonl").unwrap();
        indexed.len = replacement_stamp.len;
        indexed.modified_nanos = replacement_stamp.modified_nanos;
        indexed.file_identity = replacement_stamp.identity;
        #[cfg(unix)]
        {
            let marker = replacement_stamp.change_marker.unwrap();
            indexed.change_marker = Some(ChangeMarker {
                seconds: marker.seconds,
                nanos: marker.nanos.wrapping_add(1),
            });
        }
        #[cfg(not(unix))]
        {
            indexed.modified_nanos = replacement_stamp.modified_nanos.saturating_sub(1);
        }
        let daily = index.scan(directory.path(), utc()).unwrap();

        assert!(!daily.contains_key(&NaiveDate::from_ymd_opt(2026, 7, 23).unwrap()));
        assert_eq!(
            day_total(
                &daily,
                NaiveDate::from_ymd_opt(2026, 7, 24).unwrap(),
                Path::new("session.jsonl"),
            ),
            totals(456)
        );
    }

    #[test]
    fn truncate_rewrite_rebuilds_and_removes_the_old_contribution() {
        let directory = tempdir().unwrap();
        let session = directory.path().join("session.jsonl");
        fs::write(
            &session,
            [
                record("2026-07-23T01:00:00Z", totals(125)),
                record("2026-07-23T01:05:00Z", totals(203)),
            ]
            .concat(),
        )
        .unwrap();
        let mut index = TokenStatsIndex::default();
        index.scan(directory.path(), utc()).unwrap();

        fs::write(&session, record("2026-07-24T01:00:00Z", totals(50))).unwrap();
        let daily = index.scan(directory.path(), utc()).unwrap();

        assert!(!daily.contains_key(&NaiveDate::from_ymd_opt(2026, 7, 23).unwrap()));
        assert_eq!(
            day_total(
                &daily,
                NaiveDate::from_ymd_opt(2026, 7, 24).unwrap(),
                Path::new("session.jsonl"),
            ),
            totals(50)
        );
    }

    #[test]
    fn deletion_removes_the_file_contribution() {
        let directory = tempdir().unwrap();
        let session = directory.path().join("session.jsonl");
        fs::write(&session, record("2026-07-23T01:00:00Z", totals(125))).unwrap();
        let mut index = TokenStatsIndex::default();
        index.scan(directory.path(), utc()).unwrap();

        fs::remove_file(session).unwrap();
        let daily = index.scan(directory.path(), utc()).unwrap();

        assert!(daily.is_empty());
        assert!(index.files.is_empty());
    }

    #[test]
    fn malformed_second_file_marks_partial_without_hiding_valid_data() {
        let directory = tempdir().unwrap();
        fs::write(
            directory.path().join("valid.jsonl"),
            record("2026-07-23T01:00:00Z", totals(125)),
        )
        .unwrap();
        fs::write(directory.path().join("malformed.jsonl"), "not json\n").unwrap();
        let mut index = TokenStatsIndex::default();

        let daily = index.scan(directory.path(), utc()).unwrap();

        assert_eq!(
            day_total(
                &daily,
                NaiveDate::from_ymd_opt(2026, 7, 23).unwrap(),
                Path::new("valid.jsonl"),
            ),
            totals(125)
        );
        assert!(index.partial);
        assert_eq!(index.files.len(), 2);
    }

    #[test]
    fn trailing_fragment_is_reread_after_it_is_completed() {
        let directory = tempdir().unwrap();
        let session = directory.path().join("session.jsonl");
        let first = record("2026-07-23T01:00:00Z", totals(125));
        let second = record("2026-07-23T01:05:00Z", totals(203));
        let split = second.len() - 2;
        fs::write(&session, [&first, &second[..split]].concat()).unwrap();
        let mut index = TokenStatsIndex::default();

        let incomplete = index.scan(directory.path(), utc()).unwrap();
        assert_eq!(
            day_total(
                &incomplete,
                NaiveDate::from_ymd_opt(2026, 7, 23).unwrap(),
                Path::new("session.jsonl"),
            ),
            totals(125)
        );
        assert_eq!(index.files["session.jsonl"].cursor, first.len() as u64);
        assert!(!index.partial);

        OpenOptions::new()
            .append(true)
            .open(&session)
            .unwrap()
            .write_all(&second.as_bytes()[split..])
            .unwrap();
        let daily = index.scan(directory.path(), utc()).unwrap();

        assert_eq!(
            day_total(
                &daily,
                NaiveDate::from_ymd_opt(2026, 7, 23).unwrap(),
                Path::new("session.jsonl"),
            ),
            totals(203)
        );
        assert_eq!(
            index.files["session.jsonl"].cursor,
            fs::metadata(session).unwrap().len()
        );
    }

    #[test]
    fn timezone_change_rebuilds_all_dates_without_mixing_old_buckets() {
        let directory = tempdir().unwrap();
        fs::write(
            directory.path().join("session.jsonl"),
            record("2026-07-22T16:30:00Z", totals(125)),
        )
        .unwrap();
        let mut index = TokenStatsIndex::default();

        let utc_daily = index.scan(directory.path(), utc()).unwrap();
        assert!(utc_daily.contains_key(&NaiveDate::from_ymd_opt(2026, 7, 22).unwrap()));

        let shanghai: Tz = "Asia/Shanghai".parse().unwrap();
        let local_daily = index.scan(directory.path(), shanghai).unwrap();

        assert!(!local_daily.contains_key(&NaiveDate::from_ymd_opt(2026, 7, 22).unwrap()));
        assert_eq!(
            day_total(
                &local_daily,
                NaiveDate::from_ymd_opt(2026, 7, 23).unwrap(),
                Path::new("session.jsonl"),
            ),
            totals(125)
        );
    }

    #[test]
    fn invalid_root_preserves_existing_index_state() {
        let directory = tempdir().unwrap();
        fs::write(
            directory.path().join("session.jsonl"),
            record("2026-07-23T01:00:00Z", totals(125)),
        )
        .unwrap();
        let invalid_root = directory.path().join("not-a-directory");
        fs::write(&invalid_root, "regular file").unwrap();
        let mut index = TokenStatsIndex::default();
        index.scan(directory.path(), utc()).unwrap();
        let before = serde_json::to_string(&index).unwrap();

        let error = index.scan(&invalid_root, utc()).unwrap_err();

        assert_eq!(error.kind(), std::io::ErrorKind::NotADirectory);
        assert_eq!(serde_json::to_string(&index).unwrap(), before);
    }

    #[test]
    fn parsed_contribution_and_fingerprint_come_from_the_same_open_file() {
        let directory = tempdir().unwrap();
        let session_path = directory.path().join("session.jsonl");
        let original = record("2026-07-23T01:00:00Z", totals(125));
        let replacement = record("2026-07-24T01:00:00Z", totals(456));
        assert_eq!(original.len(), replacement.len());
        fs::write(&session_path, original).unwrap();
        let opened_original = File::open(&session_path).unwrap();

        fs::remove_file(&session_path).unwrap();
        fs::write(&session_path, replacement).unwrap();
        let opened_stamp = file_stamp(&opened_original.metadata().unwrap()).unwrap();
        let parsed_original = parse_open_file(
            opened_original,
            utc(),
            0,
            IndexedSession::default(),
            true,
            opened_stamp,
        )
        .unwrap();
        let mut index = TokenStatsIndex::default();
        index.timezone = Some("UTC".to_string());
        index
            .files
            .insert("session.jsonl".to_string(), parsed_original);
        let before_rescan = index.daily_totals();
        assert_eq!(
            day_total(
                &before_rescan,
                NaiveDate::from_ymd_opt(2026, 7, 23).unwrap(),
                Path::new("session.jsonl"),
            ),
            totals(125)
        );

        let after_rescan = index.scan(directory.path(), utc()).unwrap();

        assert!(!after_rescan.contains_key(&NaiveDate::from_ymd_opt(2026, 7, 23).unwrap()));
        assert_eq!(
            day_total(
                &after_rescan,
                NaiveDate::from_ymd_opt(2026, 7, 24).unwrap(),
                Path::new("session.jsonl"),
            ),
            totals(456)
        );
    }

    #[test]
    fn ignored_records_do_not_mark_the_index_partial() {
        let directory = tempdir().unwrap();
        fs::write(
            directory.path().join("ignored.jsonl"),
            "{\"timestamp\":\"2026-07-23T01:00:00Z\",\"type\":\"response_item\"}\n",
        )
        .unwrap();
        let mut index = TokenStatsIndex::default();

        let daily = index.scan(directory.path(), utc()).unwrap();

        assert!(daily.is_empty());
        assert!(!index.partial);
    }

    #[test]
    fn deleting_the_only_malformed_file_clears_partial() {
        let directory = tempdir().unwrap();
        let malformed = directory.path().join("malformed.jsonl");
        fs::write(&malformed, "not json\n").unwrap();
        let mut index = TokenStatsIndex::default();
        index.scan(directory.path(), utc()).unwrap();
        assert!(index.partial);

        fs::remove_file(malformed).unwrap();
        index.scan(directory.path(), utc()).unwrap();

        assert!(!index.partial);
    }

    #[test]
    fn growth_with_a_replaced_prefix_rebuilds_instead_of_appending() {
        let directory = tempdir().unwrap();
        let session = directory.path().join("session.jsonl");
        fs::write(&session, record("2026-07-23T01:00:00Z", totals(125))).unwrap();
        let mut index = TokenStatsIndex::default();
        index.scan(directory.path(), utc()).unwrap();

        fs::write(
            &session,
            [
                record("2026-07-24T01:00:00Z", totals(456)),
                record("2026-07-24T01:05:00Z", totals(500)),
            ]
            .concat(),
        )
        .unwrap();
        let daily = index.scan(directory.path(), utc()).unwrap();

        assert!(!daily.contains_key(&NaiveDate::from_ymd_opt(2026, 7, 23).unwrap()));
        assert_eq!(
            day_total(
                &daily,
                NaiveDate::from_ymd_opt(2026, 7, 24).unwrap(),
                Path::new("session.jsonl"),
            ),
            totals(500)
        );
    }

    #[test]
    fn serialized_index_contains_relative_aggregates_but_no_root_or_raw_records() {
        let directory = tempdir().unwrap();
        fs::write(
            directory.path().join("session.jsonl"),
            record("2026-07-23T01:00:00Z", totals(125)),
        )
        .unwrap();
        let mut index = TokenStatsIndex::default();
        index.scan(directory.path(), utc()).unwrap();

        let serialized = serde_json::to_string(&index).unwrap();

        assert!(serialized.contains("session.jsonl"));
        assert!(!serialized.contains(directory.path().to_str().unwrap()));
        assert!(!serialized.contains("event_msg"));
        assert!(!serialized.contains("timestamp"));
    }
}
