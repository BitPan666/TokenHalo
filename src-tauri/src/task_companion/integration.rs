use std::{fs, io::Write, path::Path};

use serde_json::{json, Value};

const OWNER: &str = "TokenHalo task companion";
const EVENTS: [&str; 3] = ["UserPromptSubmit", "PermissionRequest", "Stop"];

fn quoted(path: &Path) -> String {
    format!("\"{}\"", path.to_string_lossy().replace('"', "\\\""))
}

fn owned_handler(event: &str, executable: &Path, inbox: &Path) -> Value {
    let command = format!(
        "{} --task-hook {} --inbox {}",
        quoted(executable),
        event,
        quoted(inbox)
    );
    json!({
        "type": "command",
        "command": command,
        "commandWindows": command,
        "timeout": if event == "Stop" { 3 } else { 2 },
        "statusMessage": OWNER
    })
}

fn is_owned(handler: &Value) -> bool {
    handler.get("statusMessage").and_then(Value::as_str) == Some(OWNER)
        && handler
            .get("command")
            .and_then(Value::as_str)
            .is_some_and(|command| command.contains("--task-hook"))
}

fn read_config(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({"description": "Codex lifecycle hooks", "hooks": {}}));
    }
    let raw = fs::read_to_string(path).map_err(|_| "failed to read Codex hooks".to_string())?;
    serde_json::from_str(&raw).map_err(|_| "Codex hooks.json is invalid".to_string())
}

fn write_atomic(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "invalid hooks path".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "failed to create Codex config directory".to_string())?;
    let bytes = serde_json::to_vec_pretty(value).map_err(|_| "failed to serialize Codex hooks".to_string())?;
    serde_json::from_slice::<Value>(&bytes).map_err(|_| "generated Codex hooks are invalid".to_string())?;
    let temporary = path.with_extension("json.tmp");
    let backup = path.with_extension("json.tokenhalo.bak");
    let mut file = fs::File::create(&temporary).map_err(|_| "failed to create temporary hooks file".to_string())?;
    file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|_| "failed to write hooks file".to_string())?;
    if path.exists() {
        fs::copy(path, &backup).map_err(|_| "failed to back up Codex hooks".to_string())?;
    }
    fs::rename(temporary, path).map_err(|_| "failed to commit Codex hooks".to_string())
}

pub fn install(path: &Path, executable: &Path, inbox: &Path) -> Result<(), String> {
    let mut config = read_config(path)?;
    let hooks = config
        .as_object_mut()
        .ok_or_else(|| "Codex hooks root must be an object".to_string())?
        .entry("hooks")
        .or_insert_with(|| json!({}));
    let hooks = hooks.as_object_mut().ok_or_else(|| "Codex hooks must be an object".to_string())?;
    for event in EVENTS {
        let groups = hooks.entry(event).or_insert_with(|| json!([]));
        let groups = groups.as_array_mut().ok_or_else(|| format!("Codex {event} hooks must be an array"))?;
        for group in groups.iter_mut() {
            if let Some(handlers) = group.get_mut("hooks").and_then(Value::as_array_mut) {
                handlers.retain(|handler| !is_owned(handler));
            }
        }
        groups.retain(|group| group.get("hooks").and_then(Value::as_array).is_some_and(|items| !items.is_empty()));
        groups.push(json!({"hooks": [owned_handler(event, executable, inbox)]}));
    }
    write_atomic(path, &config)
}

pub fn uninstall(path: &Path) -> Result<(), String> {
    let mut config = read_config(path)?;
    let hooks = config.get_mut("hooks").and_then(Value::as_object_mut).ok_or_else(|| "Codex hooks ownership cannot be proven".to_string())?;
    let mut removed = 0;
    for event in EVENTS {
        if let Some(groups) = hooks.get_mut(event).and_then(Value::as_array_mut) {
            for group in groups.iter_mut() {
                if let Some(handlers) = group.get_mut("hooks").and_then(Value::as_array_mut) {
                    let before = handlers.len();
                    handlers.retain(|handler| !is_owned(handler));
                    removed += before - handlers.len();
                }
            }
            groups.retain(|group| group.get("hooks").and_then(Value::as_array).is_some_and(|items| !items.is_empty()));
        }
    }
    if removed == 0 {
        return Err("TokenHalo hook ownership cannot be proven".to_string());
    }
    write_atomic(path, &config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_is_idempotent_and_preserves_unrelated_hooks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hooks.json");
        fs::write(&path, r#"{"custom":true,"hooks":{"Stop":[{"hooks":[{"type":"command","command":"other"}]}]}}"#).unwrap();
        install(&path, Path::new("/Applications/Token Halo"), Path::new("/tmp/task inbox")).unwrap();
        install(&path, Path::new("/Applications/Token Halo"), Path::new("/tmp/task inbox")).unwrap();
        let value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["custom"], true);
        let stop = value["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2);
        assert!(path.with_extension("json.tokenhalo.bak").exists());
    }

    #[test]
    fn uninstall_removes_only_owned_handlers_and_refuses_unknown_ownership() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hooks.json");
        install(&path, Path::new("/app/tokenhalo"), Path::new("/tmp/inbox")).unwrap();
        uninstall(&path).unwrap();
        let value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert!(value["hooks"]["Stop"].as_array().unwrap().is_empty());
        assert!(uninstall(&path).is_err());
    }
}
