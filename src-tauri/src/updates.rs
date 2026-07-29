use reqwest::{
    header::{ACCEPT, LOCATION},
    Client, Url,
};
use semver::Version;
use serde::Serialize;
use std::process::Command;

const LATEST_RELEASE_URL: &str = "https://github.com/BitPan666/TokenHalo/releases/latest";
const RELEASE_PATH_PREFIX: &str = "/BitPan666/TokenHalo/releases/tag/";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateCheckResult {
    pub(crate) current_version: String,
    pub(crate) latest_version: String,
    pub(crate) update_available: bool,
    pub(crate) release_url: String,
}

pub(crate) fn release_info_from_redirect(
    current_version: &str,
    location: &str,
) -> Result<UpdateCheckResult, String> {
    let release_url = Url::parse(location).map_err(|_| "invalid release location".to_string())?;
    if release_url.scheme() != "https"
        || release_url.host_str() != Some("github.com")
        || !release_url.path().starts_with(RELEASE_PATH_PREFIX)
    {
        return Err("unexpected release location".to_string());
    }

    let tag = release_url
        .path()
        .strip_prefix(RELEASE_PATH_PREFIX)
        .filter(|value| !value.is_empty() && !value.contains('/'))
        .ok_or_else(|| "missing release version".to_string())?;
    let latest_version = tag.strip_prefix('v').unwrap_or(tag);
    let current = Version::parse(current_version.trim_start_matches('v'))
        .map_err(|_| "invalid current version".to_string())?;
    let latest =
        Version::parse(latest_version).map_err(|_| "invalid latest version".to_string())?;

    Ok(UpdateCheckResult {
        current_version: current.to_string(),
        latest_version: latest.to_string(),
        update_available: latest > current,
        release_url: release_url.to_string(),
    })
}

pub(crate) async fn check_for_updates(
    client: &Client,
    current_version: &str,
) -> Result<UpdateCheckResult, String> {
    let response = client
        .get(LATEST_RELEASE_URL)
        .header(ACCEPT, "text/html")
        .send()
        .await
        .map_err(|_| "update request failed".to_string())?;
    if !response.status().is_redirection() {
        return Err("latest release unavailable".to_string());
    }
    let location = response
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "latest release location missing".to_string())?;

    release_info_from_redirect(current_version, location)
}

pub(crate) fn open_latest_release() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(LATEST_RELEASE_URL);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", LATEST_RELEASE_URL]);
        command
    };

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(LATEST_RELEASE_URL);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|_| "failed to open release page".to_string())
}
