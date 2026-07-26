use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::Path,
};

pub(crate) const LEGACY_IDENTIFIER: &str = "app.tokenhalo.desktop";

const MIGRATED_FILES: [&str; 4] = [
    "preferences.json",
    "preferences.json.bak",
    "token-stats-index.json",
    "token-stats-index.json.bak",
];

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct MigrationReport {
    pub(crate) migrated: usize,
    pub(crate) failed: usize,
}

pub(crate) fn migrate_legacy_config(config_root: &Path, destination_dir: &Path) -> MigrationReport {
    let legacy_dir = config_root.join(LEGACY_IDENTIFIER);
    let mut report = MigrationReport::default();
    for name in MIGRATED_FILES {
        match copy_if_missing(&legacy_dir.join(name), &destination_dir.join(name)) {
            Ok(true) => report.migrated += 1,
            Ok(false) => {}
            Err(_) => report.failed += 1,
        }
    }
    report
}

fn copy_if_missing(source: &Path, destination: &Path) -> io::Result<bool> {
    if destination.exists() || !source.exists() {
        return Ok(false);
    }
    let parent = destination
        .parent()
        .ok_or_else(|| io::Error::other("migration destination has no parent"))?;
    fs::create_dir_all(parent)?;
    let file_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| io::Error::other("migration destination has no file name"))?;
    let temporary = parent.join(format!(".{file_name}.migration-{}.tmp", std::process::id()));
    let bytes = fs::read(source)?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    drop(file);
    let result = match fs::hard_link(&temporary, destination) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(error),
    };
    let _ = fs::remove_file(temporary);
    result
}

#[cfg(test)]
mod tests {
    use std::fs;

    use chrono::Utc;
    use tempfile::tempdir;

    use super::{migrate_legacy_config, LEGACY_IDENTIFIER};
    use crate::token_stats::{StatsGranularity, TokenStatsService, TokenStatsSnapshot};

    fn token_record(total_tokens: u64) -> String {
        serde_json::json!({
            "timestamp": Utc::now().to_rfc3339(),
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

    fn total_tokens(snapshot: &TokenStatsSnapshot) -> u64 {
        snapshot
            .buckets
            .iter()
            .map(|bucket| bucket.totals.total_tokens)
            .sum()
    }

    #[test]
    fn copies_allowlisted_files_without_removing_legacy_data() {
        let root = tempdir().unwrap();
        let legacy = root.path().join(LEGACY_IDENTIFIER);
        let destination = root.path().join("app.tokenhalo.desktop");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("preferences.json"), br#"{"language":"zh-CN"}"#).unwrap();
        fs::write(legacy.join("token-stats-index.json"), br#"{"version":1}"#).unwrap();

        let report = migrate_legacy_config(root.path(), &destination);

        assert_eq!(report.migrated, 2);
        assert_eq!(report.failed, 0);
        assert_eq!(
            fs::read(destination.join("preferences.json")).unwrap(),
            br#"{"language":"zh-CN"}"#
        );
        assert!(legacy.join("preferences.json").exists());
        assert!(legacy.join("token-stats-index.json").exists());
    }

    #[test]
    fn never_overwrites_existing_tokenhalo_files() {
        let root = tempdir().unwrap();
        let legacy = root.path().join(LEGACY_IDENTIFIER);
        let destination = root.path().join("app.tokenhalo.desktop");
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(&destination).unwrap();
        fs::write(legacy.join("preferences.json"), b"legacy").unwrap();
        fs::write(destination.join("preferences.json"), b"current").unwrap();

        let report = migrate_legacy_config(root.path(), &destination);

        assert_eq!(report.migrated, 0);
        assert_eq!(report.failed, 0);
        assert_eq!(
            fs::read(destination.join("preferences.json")).unwrap(),
            b"current"
        );
    }

    #[test]
    fn repeated_migration_is_idempotent() {
        let root = tempdir().unwrap();
        let legacy = root.path().join(LEGACY_IDENTIFIER);
        let destination = root.path().join("app.tokenhalo.desktop");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("preferences.json"), b"legacy").unwrap();

        assert_eq!(migrate_legacy_config(root.path(), &destination).migrated, 1);
        assert_eq!(migrate_legacy_config(root.path(), &destination).migrated, 0);
        assert_eq!(
            fs::read(destination.join("preferences.json")).unwrap(),
            b"legacy"
        );
    }

    #[test]
    fn one_failed_source_does_not_block_other_files() {
        let root = tempdir().unwrap();
        let legacy = root.path().join(LEGACY_IDENTIFIER);
        let destination = root.path().join("app.tokenhalo.desktop");
        fs::create_dir_all(legacy.join("preferences.json")).unwrap();
        fs::write(legacy.join("token-stats-index.json"), b"index").unwrap();

        let report = migrate_legacy_config(root.path(), &destination);

        assert_eq!(report.migrated, 1);
        assert_eq!(report.failed, 1);
        assert_eq!(
            fs::read(destination.join("token-stats-index.json")).unwrap(),
            b"index"
        );
    }

    #[tokio::test]
    async fn migrated_token_stats_valid_index_is_consumed() {
        let root = tempdir().unwrap();
        let legacy = root.path().join(LEGACY_IDENTIFIER);
        let destination = root.path().join("app.tokenhalo.desktop");
        let sessions = root.path().join("sessions");
        fs::create_dir_all(&sessions).unwrap();
        fs::write(sessions.join("session.jsonl"), token_record(640)).unwrap();
        let legacy_service =
            TokenStatsService::new(sessions.clone(), legacy.join("token-stats-index.json"));
        let original = legacy_service.snapshot(StatsGranularity::Day, true).await;
        assert_eq!(original.status, "ok");
        assert_eq!(total_tokens(&original), 640);
        drop(legacy_service);

        let report = migrate_legacy_config(root.path(), &destination);
        fs::remove_dir_all(&sessions).unwrap();
        fs::write(&sessions, b"not a directory").unwrap();
        let migrated_service =
            TokenStatsService::new(sessions, destination.join("token-stats-index.json"));

        let migrated = migrated_service.snapshot(StatsGranularity::Day, true).await;

        assert_eq!(report.migrated, 1);
        assert_eq!(report.failed, 0);
        assert_eq!(migrated.status, "stale");
        assert_eq!(total_tokens(&migrated), 640);
        assert!(legacy.join("token-stats-index.json").is_file());
    }

    #[tokio::test]
    async fn migrated_token_stats_invalid_index_is_safely_rebuilt() {
        let root = tempdir().unwrap();
        let legacy = root.path().join(LEGACY_IDENTIFIER);
        let destination = root.path().join("app.tokenhalo.desktop");
        let destination_cache = destination.join("token-stats-index.json");
        let sessions = root.path().join("sessions");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("token-stats-index.json"), b"not valid json").unwrap();
        fs::create_dir_all(&sessions).unwrap();
        fs::write(sessions.join("session.jsonl"), token_record(730)).unwrap();

        let report = migrate_legacy_config(root.path(), &destination);
        assert_eq!(fs::read(&destination_cache).unwrap(), b"not valid json");
        let service = TokenStatsService::new(sessions.clone(), destination_cache.clone());
        let rebuilt = service.snapshot(StatsGranularity::Day, true).await;
        drop(service);
        fs::remove_dir_all(&sessions).unwrap();
        fs::write(&sessions, b"not a directory").unwrap();
        let restarted = TokenStatsService::new(sessions, destination_cache);

        let recovered = restarted.snapshot(StatsGranularity::Day, true).await;

        assert_eq!(report.migrated, 1);
        assert_eq!(report.failed, 0);
        assert_eq!(rebuilt.status, "ok");
        assert_eq!(total_tokens(&rebuilt), 730);
        assert_eq!(recovered.status, "stale");
        assert_eq!(total_tokens(&recovered), 730);
        assert_eq!(
            fs::read(legacy.join("token-stats-index.json")).unwrap(),
            b"not valid json"
        );
    }

    #[test]
    fn startup_calls_migration_before_loading_preferences() {
        let source = include_str!("lib.rs");
        let run = source.split_once("pub fn run()").unwrap().1;
        let migration = run.find("migrate_legacy_config").unwrap();
        let preference_load = run.find("load_preferences(&preferences_path)").unwrap();

        assert!(migration < preference_load);
    }
}
