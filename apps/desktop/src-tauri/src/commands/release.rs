//! The What's new card's release-ready state (SPECs/whats-new-card-spec.md):
//! the newest GitHub release, and upgrading Pensée to it the way it was
//! installed: `brew upgrade --cask pensee` for the Homebrew cask, otherwise
//! what install.sh does (download the arm64 zip, put it in place of the
//! running app's own bundle, clear quarantine).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::commands::link_preview::client;
use crate::error::AppError;

const LATEST_URL: &str = "https://api.github.com/repos/feiyinwang/Pensee/releases/latest";

/// Homebrew's two homes: Apple Silicon, then Intel. A GUI app's PATH has neither.
const BREW_PATHS: [&str; 2] = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];
const CASK: &str = "pensee";

/// The newest release and the running app's own version (tauri.conf.json).
/// The card compares them (`isNewerVersion` in src/lib/whats-new.ts).
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub version: String,
    pub current: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    browser_download_url: String,
}

impl GithubRelease {
    /// `v0.7.0` → `0.7.0`.
    fn version(&self) -> &str {
        self.tag_name.strip_prefix('v').unwrap_or(&self.tag_name)
    }

    /// The Apple Silicon zip release.sh uploads (`Pensee-<ver>-arm64.zip`).
    fn arm64_zip(&self) -> Option<&str> {
        self.assets
            .iter()
            .map(|a| a.browser_download_url.as_str())
            .find(|url| url.ends_with("-arm64.zip"))
    }
}

/// The repo's latest GitHub release. `PENSEE_RELEASE_FILE` reads the same
/// JSON from a local file instead (the e2e journeys).
async fn fetch_latest() -> Result<GithubRelease, AppError> {
    let body = if let Ok(path) = std::env::var("PENSEE_RELEASE_FILE") {
        tokio::fs::read(&path).await?
    } else {
        client()?
            .get(LATEST_URL)
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| AppError::Network(e.to_string()))?
            .error_for_status()
            .map_err(|e| AppError::Network(e.to_string()))?
            .bytes()
            .await
            .map_err(|e| AppError::Network(e.to_string()))?
            .to_vec()
    };
    serde_json::from_slice(&body)
        .map_err(|e| AppError::Network(format!("unreadable release from GitHub: {e}")))
}

#[tauri::command]
pub async fn latest_release(app: AppHandle) -> Result<Release, AppError> {
    let release = fetch_latest().await?;
    Ok(Release {
        version: release.version().to_string(),
        current: app.package_info().version.to_string(),
    })
}

/// Upgrades Pensée to the latest release, the way it was installed. It
/// returns once the new app is in place; `restart_app` opens it.
/// `PENSEE_UPGRADE_FILE` fakes it for the e2e journeys: after a second it
/// succeeds when the file says `ok` and fails with the file's text otherwise.
#[tauri::command]
pub async fn upgrade_app() -> Result<(), AppError> {
    if let Ok(path) = std::env::var("PENSEE_UPGRADE_FILE") {
        tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_secs(1)))
            .await
            .map_err(|e| AppError::User(e.to_string()))?;
        let outcome = tokio::fs::read_to_string(&path).await?;
        return match outcome.trim() {
            "ok" => Ok(()),
            message => Err(AppError::User(message.to_string())),
        };
    }
    if let Some(brew) = tauri::async_runtime::spawn_blocking(brew_cask)
        .await
        .map_err(|e| AppError::User(e.to_string()))?
    {
        return tauri::async_runtime::spawn_blocking(move || {
            run(
                Command::new(brew).args(["upgrade", "--cask", CASK]),
                "Homebrew couldn't upgrade Pensée",
            )
        })
        .await
        .map_err(|e| AppError::User(e.to_string()))?;
    }
    upgrade_from_zip().await
}

/// Relaunches Pensée, so an upgrade takes effect. The app exits through its
/// normal path first, which frees the single-instance socket for the new one.
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.request_restart();
}

/// Homebrew's path when the `pensee` cask is installed with it.
fn brew_cask() -> Option<PathBuf> {
    let brew = BREW_PATHS.iter().map(Path::new).find(|p| p.exists())?;
    let listed = Command::new(brew)
        .args(["list", "--cask", CASK])
        .output()
        .is_ok_and(|out| out.status.success());
    listed.then(|| brew.to_path_buf())
}

/// install.sh's way: download the release zip and swap it in for the running
/// app's bundle.
async fn upgrade_from_zip() -> Result<(), AppError> {
    let exe = std::env::current_exe()?;
    let bundle = app_bundle(&exe).ok_or_else(|| {
        AppError::User("Pensée isn't running from an app, so it can't update itself.".into())
    })?;
    let release = fetch_latest().await?;
    let url = release.arm64_zip().ok_or_else(|| {
        AppError::User(format!(
            "Pensée {} has no Apple Silicon download.",
            release.version()
        ))
    })?;
    let zip = download(url).await?;

    let work = std::env::temp_dir().join(format!("pensee-upgrade-{}", std::process::id()));
    tauri::async_runtime::spawn_blocking(move || {
        let _ = std::fs::remove_dir_all(&work);
        std::fs::create_dir_all(&work)?;
        let result = install_zip(&zip, &work, &bundle);
        let _ = std::fs::remove_dir_all(&work);
        result
    })
    .await
    .map_err(|e| AppError::User(e.to_string()))?
}

/// The zip, with a timeout long enough for a slow connection (the shared
/// client's 10 seconds is for link previews).
async fn download(url: &str) -> Result<Vec<u8>, AppError> {
    // The shared client installs the TLS provider this client needs too.
    client()?;
    let downloads = reqwest::Client::builder()
        .timeout(Duration::from_secs(10 * 60))
        .user_agent("Pensee updater")
        .build()
        .map_err(|e| AppError::Network(e.to_string()))?;
    let bytes = downloads
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| AppError::Network(e.to_string()))?
        .bytes()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    Ok(bytes.to_vec())
}

/// Unzips `zip` in `work` and puts its app where `bundle` is. The new app is
/// copied next to the old one first and then renamed into place, so a failed
/// copy leaves the running app untouched.
fn install_zip(zip: &[u8], work: &Path, bundle: &Path) -> Result<(), AppError> {
    let zip_path = work.join("Pensee.zip");
    std::fs::write(&zip_path, zip)?;
    let unpacked = work.join("unpacked");
    run(
        Command::new("ditto")
            .arg("-x")
            .arg("-k")
            .arg(&zip_path)
            .arg(&unpacked),
        "Couldn't unzip the new Pensée",
    )?;
    let new_app = std::fs::read_dir(&unpacked)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .ok_or_else(|| AppError::User("The download had no app in it.".into()))?;

    let (staged, old) = (sibling(bundle, "new"), sibling(bundle, "old"));
    let _ = std::fs::remove_dir_all(&staged);
    let _ = std::fs::remove_dir_all(&old);
    run(
        Command::new("ditto").arg(&new_app).arg(&staged),
        &format!(
            "Couldn't copy the new Pensée into {}",
            bundle.parent().unwrap_or(bundle).display()
        ),
    )?;
    std::fs::rename(bundle, &old)?;
    if let Err(error) = std::fs::rename(&staged, bundle) {
        let _ = std::fs::rename(&old, bundle);
        return Err(error.into());
    }
    if let Err(error) = std::fs::remove_dir_all(&old) {
        eprintln!("[upgrade] Couldn't remove {}: {error}", old.display());
    }
    // Not notarized: Gatekeeper would refuse a quarantined copy (install.sh).
    if let Err(error) = run(
        Command::new("xattr")
            .args(["-dr", "com.apple.quarantine"])
            .arg(bundle),
        "Couldn't clear quarantine",
    ) {
        eprintln!("[upgrade] {error}");
    }
    Ok(())
}

/// The `.app` that holds `exe` (`X.app/Contents/MacOS/x`), if it's in one.
fn app_bundle(exe: &Path) -> Option<PathBuf> {
    let bundle = exe.parent()?.parent()?.parent()?;
    let in_bundle = exe.parent()?.ends_with("Contents/MacOS")
        && bundle.extension().is_some_and(|ext| ext == "app");
    in_bundle.then(|| bundle.to_path_buf())
}

/// `/Applications/Pensée.app` → `/Applications/.Pensée.app.<tag>`.
fn sibling(bundle: &Path, tag: &str) -> PathBuf {
    let name = bundle.file_name().unwrap_or_default().to_string_lossy();
    bundle.with_file_name(format!(".{name}.{tag}"))
}

/// Runs `cmd`; a failure becomes `what`, with the command's last line of stderr.
fn run(cmd: &mut Command, what: &str) -> Result<(), AppError> {
    let out = cmd
        .output()
        .map_err(|e| AppError::User(format!("{what}: {e}")))?;
    if out.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    let reason = stderr
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map_or_else(|| out.status.to_string(), |line| line.trim().to_string());
    Err(AppError::User(format!("{what}: {reason}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    const RELEASE_JSON: &str = r#"{
        "tag_name": "v0.7.0",
        "name": "Pensée 0.7.0",
        "assets": [
            { "name": "notes.txt", "browser_download_url": "https://github.com/feiyinwang/Pensee/releases/download/v0.7.0/notes.txt" },
            { "name": "Pensee-0.7.0-arm64.zip", "browser_download_url": "https://github.com/feiyinwang/Pensee/releases/download/v0.7.0/Pensee-0.7.0-arm64.zip" }
        ]
    }"#;

    #[test]
    fn reads_the_version_and_the_arm64_zip() {
        let release: GithubRelease = serde_json::from_str(RELEASE_JSON).unwrap();
        assert_eq!(release.version(), "0.7.0");
        assert_eq!(
            release.arm64_zip(),
            Some(
                "https://github.com/feiyinwang/Pensee/releases/download/v0.7.0/Pensee-0.7.0-arm64.zip"
            )
        );
    }

    #[test]
    fn a_tag_without_v_and_no_assets_still_reads() {
        let release: GithubRelease = serde_json::from_str(r#"{"tag_name":"0.8.1"}"#).unwrap();
        assert_eq!(release.version(), "0.8.1");
        assert_eq!(release.arm64_zip(), None);
    }

    #[test]
    fn finds_the_bundle_around_the_binary() {
        assert_eq!(
            app_bundle(Path::new("/Applications/Pensée.app/Contents/MacOS/pensee")),
            Some(PathBuf::from("/Applications/Pensée.app"))
        );
        // `tauri dev` runs the bare binary: there's no bundle to replace.
        assert_eq!(app_bundle(Path::new("/code/target/debug/pensee")), None);
    }

    #[test]
    fn stages_beside_the_bundle() {
        assert_eq!(
            sibling(Path::new("/Applications/Pensée.app"), "new"),
            PathBuf::from("/Applications/.Pensée.app.new")
        );
    }

    #[test]
    fn a_failed_command_reports_its_last_stderr_line() {
        let error = run(
            Command::new("sh").args(["-c", "echo first >&2; echo 'no space left' >&2; exit 3"]),
            "Couldn't copy",
        )
        .unwrap_err();
        assert_eq!(error.to_string(), "Couldn't copy: no space left");
        assert!(run(&mut Command::new("true"), "unused").is_ok());
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn install_zip_swaps_the_new_app_in() {
        let root = std::env::temp_dir().join(format!("pensee-install-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        // An installed app, and a release zip holding a newer one.
        let installed = root.join("Applications/Pensée.app");
        std::fs::create_dir_all(installed.join("Contents/MacOS")).unwrap();
        std::fs::write(installed.join("Contents/version"), "old").unwrap();
        std::fs::write(installed.join("Contents/stale"), "gone after").unwrap();
        let release = root.join("release/Pensée.app/Contents");
        std::fs::create_dir_all(&release).unwrap();
        std::fs::write(release.join("version"), "new").unwrap();
        let zip_path = root.join("release.zip");
        let zipped = Command::new("ditto")
            .args(["-c", "-k", "--keepParent"])
            .arg(root.join("release/Pensée.app"))
            .arg(&zip_path)
            .status()
            .unwrap();
        assert!(zipped.success());

        let work = root.join("work");
        std::fs::create_dir_all(&work).unwrap();
        install_zip(&std::fs::read(&zip_path).unwrap(), &work, &installed).unwrap();

        assert_eq!(
            std::fs::read_to_string(installed.join("Contents/version")).unwrap(),
            "new"
        );
        assert!(!installed.join("Contents/stale").exists());
        assert!(!sibling(&installed, "old").exists());
        assert!(!sibling(&installed, "new").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
