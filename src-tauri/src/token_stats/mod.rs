mod cache;
mod index;
mod models;
mod parser;
mod periods;

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

use chrono::Utc;
use chrono_tz::Tz;

pub(crate) use self::models::{StatsGranularity, TokenStatsSnapshot};
use self::{
    index::TokenStatsIndex,
    models::{DailySessionTotals, STATUS_EMPTY, STATUS_OK, STATUS_STALE, STATUS_UNAVAILABLE},
    periods::build_buckets,
};

const SCAN_TTL: Duration = Duration::from_secs(60);
const CACHE_PERSISTENCE_WARNING: &str =
    "Token statistics are current, but restart cache persistence failed.";
type TimezoneResolver = fn() -> Tz;

pub(crate) struct TokenStatsService {
    root: PathBuf,
    cache_path: PathBuf,
    scan_lock: tokio::sync::Mutex<()>,
    index: Mutex<TokenStatsIndex>,
    last_snapshot: Mutex<HashMap<StatsGranularity, TokenStatsSnapshot>>,
    last_scan: Mutex<Option<Instant>>,
    timezone_resolver: TimezoneResolver,
}

impl TokenStatsService {
    pub(crate) fn new(root: PathBuf, cache_path: PathBuf) -> Self {
        Self::new_with_resolver(root, cache_path, runtime_timezone)
    }

    fn new_with_resolver(
        root: PathBuf,
        cache_path: PathBuf,
        timezone_resolver: TimezoneResolver,
    ) -> Self {
        let index = cache::load(&cache_path).unwrap_or_default();
        Self {
            root,
            cache_path,
            scan_lock: tokio::sync::Mutex::new(()),
            index: Mutex::new(index),
            last_snapshot: Mutex::new(HashMap::new()),
            last_scan: Mutex::new(None),
            timezone_resolver,
        }
    }

    pub(crate) async fn snapshot(
        &self,
        granularity: StatsGranularity,
        force: bool,
    ) -> TokenStatsSnapshot {
        let _scan_guard = self.scan_lock.lock().await;
        let timezone = (self.timezone_resolver)();
        if !force && self.scan_is_fresh() && self.index_timezone_matches(timezone) {
            if let Some(snapshot) = self.cached_snapshot(granularity) {
                return snapshot;
            }
            return self.snapshot_from_current_index(granularity, timezone);
        }

        let now = Utc::now();
        let scan_result = self.index.lock().map_err(|_| ()).and_then(|mut index| {
            let daily = index.scan(&self.root, timezone).map_err(|_| ())?;
            let partial = index.partial;
            let cache_persisted = cache::save(&self.cache_path, &index).is_ok();
            Ok((daily, partial, cache_persisted))
        });

        match scan_result {
            Ok((daily, partial, cache_persisted)) => {
                if let Ok(mut last_scan) = self.last_scan.lock() {
                    *last_scan = Some(Instant::now());
                }
                let mut snapshot = build_snapshot(daily, granularity, timezone, now, partial);
                if !cache_persisted {
                    snapshot.message = Some(CACHE_PERSISTENCE_WARNING.to_string());
                }
                if let Ok(mut snapshots) = self.last_snapshot.lock() {
                    snapshots.clear();
                    snapshots.insert(granularity, snapshot.clone());
                }
                snapshot
            }
            Err(()) => {
                if let Ok(mut last_scan) = self.last_scan.lock() {
                    *last_scan = None;
                }
                self.failed_snapshot(granularity, timezone)
            }
        }
    }

    fn scan_is_fresh(&self) -> bool {
        self.last_scan
            .lock()
            .ok()
            .and_then(|last_scan| *last_scan)
            .is_some_and(|last_scan| last_scan.elapsed() < SCAN_TTL)
    }

    fn cached_snapshot(&self, granularity: StatsGranularity) -> Option<TokenStatsSnapshot> {
        self.last_snapshot
            .lock()
            .ok()
            .and_then(|snapshots| snapshots.get(&granularity).cloned())
    }

    fn index_timezone_matches(&self, timezone: Tz) -> bool {
        let timezone_name = timezone.to_string();
        self.index
            .lock()
            .ok()
            .is_some_and(|index| index.timezone.as_deref() == Some(timezone_name.as_str()))
    }

    fn snapshot_from_current_index(
        &self,
        granularity: StatsGranularity,
        timezone: Tz,
    ) -> TokenStatsSnapshot {
        let now = Utc::now();
        let (daily, partial) = self
            .index
            .lock()
            .map(|index| (daily_totals(&index), index.partial))
            .unwrap_or_default();
        let snapshot = build_snapshot(daily, granularity, timezone, now, partial);
        if let Ok(mut snapshots) = self.last_snapshot.lock() {
            snapshots.insert(granularity, snapshot.clone());
        }
        snapshot
    }

    fn failed_snapshot(&self, granularity: StatsGranularity, timezone: Tz) -> TokenStatsSnapshot {
        if let Some(snapshot) = self.cached_snapshot(granularity) {
            return stale_snapshot(snapshot);
        }
        let timezone_name = timezone.to_string();
        if let Some(snapshot) = self.index.lock().ok().and_then(|index| {
            let timezone_matches = index.timezone.as_deref() == Some(timezone_name.as_str());
            let daily = timezone_matches.then(|| daily_totals(&index))?;
            (!daily.is_empty())
                .then(|| build_snapshot(daily, granularity, timezone, Utc::now(), index.partial))
        }) {
            return stale_snapshot(snapshot);
        }
        TokenStatsSnapshot {
            status: STATUS_UNAVAILABLE.to_string(),
            granularity,
            buckets: Vec::new(),
            updated_at: Utc::now().to_rfc3339(),
            message: Some("Token statistics are temporarily unavailable.".to_string()),
            partial: false,
        }
    }
}

fn stale_snapshot(mut snapshot: TokenStatsSnapshot) -> TokenStatsSnapshot {
    snapshot.status = STATUS_STALE.to_string();
    snapshot.message =
        Some("Token statistics could not be refreshed; showing cached data.".to_string());
    snapshot
}

fn runtime_timezone() -> Tz {
    iana_time_zone::get_timezone()
        .ok()
        .and_then(|timezone| timezone.parse().ok())
        .unwrap_or(chrono_tz::UTC)
}

fn daily_totals(index: &TokenStatsIndex) -> DailySessionTotals {
    let mut daily = DailySessionTotals::new();
    for (relative_path, session) in &index.files {
        for (date, totals) in &session.by_day {
            daily
                .entry(*date)
                .or_default()
                .insert(PathBuf::from(relative_path), *totals);
        }
    }
    daily
}

fn build_snapshot(
    daily: DailySessionTotals,
    granularity: StatsGranularity,
    timezone: Tz,
    now: chrono::DateTime<Utc>,
    partial: bool,
) -> TokenStatsSnapshot {
    let status = if daily.is_empty() {
        STATUS_EMPTY
    } else {
        STATUS_OK
    };
    TokenStatsSnapshot {
        status: status.to_string(),
        granularity,
        buckets: build_buckets(&daily, granularity, now, timezone),
        updated_at: now.to_rfc3339(),
        message: None,
        partial,
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::atomic::{AtomicU8, AtomicUsize, Ordering},
    };

    use chrono::{Duration, Utc};
    use chrono_tz::{Asia::Shanghai, Tz, UTC};
    use tempfile::tempdir;

    use super::{StatsGranularity, TokenStatsService};

    static TEST_TIMEZONE: AtomicU8 = AtomicU8::new(0);
    static TIMEZONE_RESOLVER_CALLS: AtomicUsize = AtomicUsize::new(0);

    fn changing_timezone() -> Tz {
        TIMEZONE_RESOLVER_CALLS.fetch_add(1, Ordering::SeqCst);
        match TEST_TIMEZONE.load(Ordering::SeqCst) {
            0 => UTC,
            _ => Shanghai,
        }
    }

    fn token_record_at(timestamp: &str, total_tokens: u64) -> String {
        serde_json::json!({
            "timestamp": timestamp,
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": total_tokens,
                        "cached_input_tokens": 0,
                        "output_tokens": 0,
                        "reasoning_output_tokens": 0,
                        "total_tokens": total_tokens
                    }
                }
            }
        })
        .to_string()
            + "\n"
    }

    fn token_record(total_tokens: u64) -> String {
        token_record_at(&Utc::now().to_rfc3339(), total_tokens)
    }

    #[tokio::test]
    async fn missing_session_root_returns_empty_snapshot() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("missing-sessions");
        let service = TokenStatsService::new(root, directory.path().join("token-stats-index.json"));

        let snapshot = service.snapshot(StatsGranularity::Day, false).await;

        assert_eq!(snapshot.status, "empty");
        assert_eq!(snapshot.buckets.len(), 7);
        assert!(!snapshot.partial);
        assert!(snapshot.message.is_none());
    }

    #[tokio::test]
    async fn successful_scan_returns_ok_and_persists_the_index() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("sessions");
        let cache_path = directory.path().join("token-stats-index.json");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("session.jsonl"), token_record(125)).unwrap();
        let service = TokenStatsService::new(root, cache_path.clone());

        let snapshot = service.snapshot(StatsGranularity::Day, false).await;

        assert_eq!(snapshot.status, "ok");
        assert_eq!(
            snapshot
                .buckets
                .iter()
                .map(|bucket| bucket.totals.total_tokens)
                .sum::<u64>(),
            125
        );
        assert!(!snapshot.partial);
        assert!(cache_path.is_file());
    }

    #[tokio::test]
    async fn malformed_records_mark_an_otherwise_successful_snapshot_partial() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("sessions");
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("session.jsonl"),
            format!("not-json\n{}", token_record(80)),
        )
        .unwrap();
        let service = TokenStatsService::new(root, directory.path().join("token-stats-index.json"));

        let snapshot = service.snapshot(StatsGranularity::Day, false).await;

        assert_eq!(snapshot.status, "ok");
        assert!(snapshot.partial);
    }

    #[tokio::test]
    async fn fresh_snapshot_skips_scan_until_forced_then_retains_stale_data_on_failure() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("sessions");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("session.jsonl"), token_record(250)).unwrap();
        let service = TokenStatsService::new(
            root.clone(),
            directory.path().join("token-stats-index.json"),
        );
        let current = service.snapshot(StatsGranularity::Day, false).await;
        fs::remove_dir_all(&root).unwrap();
        fs::write(&root, b"not a directory").unwrap();

        let cached = service.snapshot(StatsGranularity::Day, false).await;
        let stale = service.snapshot(StatsGranularity::Day, true).await;

        assert_eq!(cached.status, "ok");
        assert_eq!(cached.buckets, current.buckets);
        assert_eq!(stale.status, "stale");
        assert_eq!(stale.buckets, current.buckets);
        assert_eq!(stale.updated_at, current.updated_at);
        assert!(stale.message.is_some());
    }

    #[tokio::test]
    async fn refresh_failure_without_previous_data_returns_unavailable() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("sessions");
        fs::write(&root, b"not a directory").unwrap();
        let service = TokenStatsService::new(root, directory.path().join("token-stats-index.json"));

        let snapshot = service.snapshot(StatsGranularity::Week, true).await;

        assert_eq!(snapshot.status, "unavailable");
        assert!(snapshot.buckets.is_empty());
        assert!(!snapshot.partial);
        assert!(snapshot.message.is_some());
    }

    #[tokio::test]
    async fn persisted_index_is_stale_data_after_a_restart_refresh_failure() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("sessions");
        let cache_path = directory.path().join("token-stats-index.json");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("session.jsonl"), token_record(320)).unwrap();
        let first_service = TokenStatsService::new(root.clone(), cache_path.clone());
        assert_eq!(
            first_service
                .snapshot(StatsGranularity::Day, true)
                .await
                .status,
            "ok"
        );
        drop(first_service);
        fs::remove_dir_all(&root).unwrap();
        fs::write(&root, b"not a directory").unwrap();
        let restarted_service = TokenStatsService::new(root, cache_path);

        let snapshot = restarted_service
            .snapshot(StatsGranularity::Day, true)
            .await;

        assert_eq!(snapshot.status, "stale");
        assert_eq!(
            snapshot
                .buckets
                .iter()
                .map(|bucket| bucket.totals.total_tokens)
                .sum::<u64>(),
            320
        );
        assert!(snapshot.message.is_some());
    }

    #[tokio::test]
    async fn timezone_change_inside_ttl_rebuilds_dates_before_reusing_snapshots() {
        TEST_TIMEZONE.store(0, Ordering::SeqCst);
        TIMEZONE_RESOLVER_CALLS.store(0, Ordering::SeqCst);
        let directory = tempdir().unwrap();
        let root = directory.path().join("sessions");
        fs::create_dir_all(&root).unwrap();
        let utc_date = Utc::now().date_naive() - Duration::days(1);
        let timestamp = utc_date.and_hms_opt(23, 30, 0).unwrap().and_utc();
        let shanghai_date = timestamp.with_timezone(&Shanghai).date_naive();
        fs::write(
            root.join("session.jsonl"),
            token_record_at(&timestamp.to_rfc3339(), 410),
        )
        .unwrap();
        let service = TokenStatsService::new_with_resolver(
            root,
            directory.path().join("token-stats-index.json"),
            changing_timezone,
        );

        let utc_snapshot = service.snapshot(StatsGranularity::Day, false).await;
        TEST_TIMEZONE.store(1, Ordering::SeqCst);
        let shanghai_snapshot = service.snapshot(StatsGranularity::Day, false).await;

        assert_eq!(TIMEZONE_RESOLVER_CALLS.load(Ordering::SeqCst), 2);
        assert_eq!(
            utc_snapshot
                .buckets
                .iter()
                .find(|bucket| bucket.key == utc_date.to_string())
                .unwrap()
                .totals
                .total_tokens,
            410
        );
        assert_eq!(
            shanghai_snapshot
                .buckets
                .iter()
                .find(|bucket| bucket.key == shanghai_date.to_string())
                .unwrap()
                .totals
                .total_tokens,
            410
        );
        assert_eq!(
            service.index.lock().unwrap().timezone.as_deref(),
            Some("Asia/Shanghai")
        );
    }

    #[tokio::test]
    async fn cache_write_failure_keeps_fresh_data_and_reports_safe_warning() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("sessions");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("session.jsonl"), token_record(515)).unwrap();
        let blocked_cache_parent = directory.path().join("not-a-directory");
        fs::write(&blocked_cache_parent, b"file blocks cache directory").unwrap();
        let service =
            TokenStatsService::new(root, blocked_cache_parent.join("token-stats-index.json"));

        let snapshot = service.snapshot(StatsGranularity::Day, true).await;

        assert_eq!(snapshot.status, "ok");
        assert_eq!(
            snapshot
                .buckets
                .iter()
                .map(|bucket| bucket.totals.total_tokens)
                .sum::<u64>(),
            515
        );
        assert!(!snapshot.partial);
        assert_eq!(
            snapshot.message.as_deref(),
            Some("Token statistics are current, but restart cache persistence failed.")
        );
        assert!(!snapshot
            .message
            .as_deref()
            .unwrap()
            .contains(directory.path().to_string_lossy().as_ref()));
    }
}
