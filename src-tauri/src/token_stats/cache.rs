use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

use super::index::{TokenStatsIndex, INDEX_VERSION};

pub(crate) fn save(path: &Path, index: &TokenStatsIndex) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| "failed to create token statistics cache directory".to_string())?;
    }
    let serialized = serde_json::to_vec(index)
        .map_err(|_| "failed to serialize token statistics cache".to_string())?;
    let temporary = temporary_path(path);
    write_synced(&temporary, &serialized)
        .map_err(|_| "failed to write token statistics cache".to_string())?;
    commit_temporary_with(path, &temporary, |from, to| fs::rename(from, to))
}

fn commit_temporary_with<F>(path: &Path, temporary: &Path, install: F) -> Result<(), String>
where
    F: FnOnce(&Path, &Path) -> io::Result<()>,
{
    let backup = backup_path(path);
    let current_is_valid = load_candidate(path).is_some();
    if current_is_valid {
        let _ = fs::remove_file(&backup);
        fs::rename(path, &backup)
            .map_err(|_| "failed to back up token statistics cache".to_string())?;
    } else if path.exists() {
        fs::remove_file(path)
            .map_err(|_| "failed to replace invalid token statistics cache".to_string())?;
    }
    if let Err(error) = install(temporary, path) {
        if current_is_valid {
            let _ = restore_backup(&backup, path);
        }
        return Err(format!("failed to commit token statistics cache: {error}"));
    }
    Ok(())
}

pub(crate) fn load(path: &Path) -> Option<TokenStatsIndex> {
    if let Some(index) = load_candidate(path) {
        return Some(index);
    }
    let backup = backup_path(path);
    let index = load_candidate(&backup)?;
    let _ = restore_backup(&backup, path);
    Some(index)
}

fn load_candidate(path: &Path) -> Option<TokenStatsIndex> {
    let raw = fs::read(path).ok()?;
    let index = serde_json::from_slice::<TokenStatsIndex>(&raw).ok()?;
    (index.version == INDEX_VERSION).then_some(index)
}

fn temporary_path(path: &Path) -> PathBuf {
    path.with_extension("json.tmp")
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

fn restore_backup(backup: &Path, path: &Path) -> io::Result<()> {
    let serialized = fs::read(backup)?;
    let recovery = path.with_extension("json.recovery.tmp");
    write_synced(&recovery, &serialized)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(recovery, path)
}

fn write_synced(path: &Path, serialized: &[u8]) -> io::Result<()> {
    let mut file = fs::File::create(path)?;
    file.write_all(serialized)?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use std::{fs, io};

    use chrono_tz::UTC;
    use tempfile::tempdir;

    use super::{backup_path, commit_temporary_with, load, load_candidate, save, temporary_path};
    use crate::token_stats::index::{TokenStatsIndex, INDEX_VERSION};

    fn populated_index() -> TokenStatsIndex {
        let root = tempdir().unwrap();
        let sessions = root.path().join("sessions");
        fs::create_dir_all(&sessions).unwrap();
        fs::write(
            sessions.join("session.jsonl"),
            concat!(
                r#"{"timestamp":"2026-07-23T01:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5,"total_tokens":125}}}}"#,
                "\n"
            ),
        )
        .unwrap();
        let mut index = TokenStatsIndex::default();
        index.scan(&sessions, UTC).unwrap();
        index
    }

    #[test]
    fn save_and_load_round_trip_the_index() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("token-stats-index.json");
        let index = populated_index();

        save(&path, &index).unwrap();
        let loaded = load(&path).unwrap();

        assert_eq!(loaded.version, INDEX_VERSION);
        assert_eq!(loaded.timezone.as_deref(), Some("UTC"));
        assert_eq!(loaded.files.len(), 1);
        assert!(loaded.files.contains_key("session.jsonl"));
    }

    #[test]
    fn invalid_main_cache_recovers_from_valid_backup() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("token-stats-index.json");
        let backup = directory.path().join("token-stats-index.json.bak");
        let index = populated_index();
        save(&path, &index).unwrap();
        fs::copy(&path, &backup).unwrap();
        fs::write(&path, b"not valid json").unwrap();

        let loaded = load(&path).unwrap();

        assert_eq!(loaded.files.len(), 1);
        assert!(loaded.files.contains_key("session.jsonl"));
    }

    #[test]
    fn recovered_backup_remains_valid_when_the_next_commit_fails() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("token-stats-index.json");
        let backup = backup_path(&path);
        let original = populated_index();
        save(&path, &original).unwrap();
        fs::copy(&path, &backup).unwrap();
        fs::write(&path, b"not valid json").unwrap();

        let recovered = load(&path).unwrap();
        assert_eq!(recovered.files.len(), 1);
        assert!(load_candidate(&path).is_some());
        assert!(load_candidate(&backup).is_some());
        let temporary = temporary_path(&path);
        fs::write(
            &temporary,
            serde_json::to_vec(&TokenStatsIndex::default()).unwrap(),
        )
        .unwrap();

        let result = commit_temporary_with(&path, &temporary, |_, _| {
            Err(io::Error::other("injected commit failure"))
        });

        assert!(result.is_err());
        assert!(load_candidate(&path).is_some());
        assert!(load_candidate(&backup).is_some());
        assert_eq!(load(&path).unwrap().files.len(), 1);
    }

    #[test]
    fn legacy_version_is_rejected_for_a_full_rebuild() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("token-stats-index.json");
        let mut value = serde_json::to_value(TokenStatsIndex::default()).unwrap();
        value["version"] = serde_json::json!(INDEX_VERSION - 1);
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();

        assert!(load(&path).is_none());
    }

    #[test]
    fn current_version_missing_incremental_fields_uses_serde_defaults() {
        let index = populated_index();
        let mut value = serde_json::to_value(index).unwrap();
        let session = value["files"]["session.jsonl"].as_object_mut().unwrap();
        session.remove("file_identity");
        session.remove("change_marker");
        session.remove("boundary_fingerprint");
        session.remove("boundary_len");

        let decoded = serde_json::from_value::<TokenStatsIndex>(value).unwrap();

        assert_eq!(decoded.version, INDEX_VERSION);
        assert_eq!(decoded.files.len(), 1);
    }

    #[test]
    fn serialized_cache_contains_neither_prompt_text_nor_absolute_root() {
        const PROMPT: &str = "PRIVATE_PROMPT_SENTINEL_7b11";
        let directory = tempdir().unwrap();
        let sessions = directory.path().join("sessions");
        fs::create_dir_all(&sessions).unwrap();
        fs::write(
            sessions.join("private-session.jsonl"),
            format!(
                "{}\n{}\n",
                serde_json::json!({
                    "timestamp": "2026-07-23T01:00:00Z",
                    "type": "user_message",
                    "payload": {"message": PROMPT}
                }),
                serde_json::json!({
                    "timestamp": "2026-07-23T01:05:00Z",
                    "type": "event_msg",
                    "payload": {
                        "type": "token_count",
                        "info": {
                            "total_token_usage": {
                                "input_tokens": 100,
                                "cached_input_tokens": 40,
                                "output_tokens": 20,
                                "reasoning_output_tokens": 5,
                                "total_tokens": 125
                            }
                        }
                    }
                })
            ),
        )
        .unwrap();
        let mut index = TokenStatsIndex::default();
        index.scan(&sessions, UTC).unwrap();
        let cache_path = directory.path().join("token-stats-index.json");

        save(&cache_path, &index).unwrap();
        let serialized = fs::read_to_string(cache_path).unwrap();

        assert!(!serialized.contains(PROMPT));
        assert!(!serialized.contains(directory.path().to_string_lossy().as_ref()));
        assert!(serialized.contains("private-session.jsonl"));
    }
}
