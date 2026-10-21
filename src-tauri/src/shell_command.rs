//! The `git-sea` shell command on macOS: a small script in `/usr/local/bin` that opens the given
//! folders (the current one by default) with the app, as VS Code's `code` does. It goes through
//! `open -a`, so the terminal is free at once and a running app gets the folders as new tabs.
//!
//! On Linux the `.deb` and `.rpm` packages already put the program in `/usr/bin/git-sea`; on
//! Windows nothing is installed.

use std::path::{Path, PathBuf};

use serde::Serialize;
use specta::Type;

use crate::error::AppError;

/// Where the command goes; on the default `PATH` of macOS.
pub const TARGET: &str = "/usr/local/bin/git-sea";

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShellCommandStatus {
    /// The command can be installed from here: macOS, running from an app bundle.
    pub installable: bool,
    /// The command is there and opens this copy of the app.
    pub installed: bool,
    pub path: String,
}

/// The script that opens `app` (the `.app` bundle) with the folders it is given.
pub fn script(app: &Path) -> String {
    let app = app.display().to_string().replace('\'', r"'\''");
    format!(
        r#"#!/bin/sh
# Opens git repositories in git-sea: `git-sea` for the current folder, or `git-sea <path>...`.
# Written by git-sea; install it again from its settings if the app is moved.
app='{app}'
[ "$#" -eq 0 ] && set -- .
for path in "$@"; do
  case "$path" in /*) ;; *) path="$PWD/$path" ;; esac
  set -- "$@" "$path"
  shift
done
exec open -a "$app" "$@"
"#
    )
}

/// The `.app` bundle the running program is in, if any (not in `tauri dev`).
fn app_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    // …/git-sea.app/Contents/MacOS/git-sea
    let bundle = exe.parent()?.parent()?.parent()?;
    bundle
        .extension()
        .is_some_and(|ext| ext == "app")
        .then(|| bundle.to_path_buf())
}

pub fn status() -> ShellCommandStatus {
    let bundle = if cfg!(target_os = "macos") {
        app_bundle()
    } else {
        None
    };
    let installed = bundle
        .as_ref()
        .is_some_and(|app| std::fs::read_to_string(TARGET).is_ok_and(|text| text == script(app)));
    ShellCommandStatus {
        installable: bundle.is_some(),
        installed,
        path: TARGET.to_owned(),
    }
}

/// Writes the script, asking for an administrator's password when `/usr/local/bin` is not
/// writable (the usual case on Apple silicon, where Homebrew lives elsewhere).
#[cfg(target_os = "macos")]
pub fn install() -> Result<ShellCommandStatus, AppError> {
    use std::os::unix::fs::PermissionsExt;

    let app = app_bundle().ok_or_else(|| {
        AppError::Internal("the shell command can only be installed from the app bundle".into())
    })?;
    let text = script(&app);
    let target = Path::new(TARGET);
    let direct = target
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| std::fs::write(target, &text))
        .and_then(|()| std::fs::set_permissions(target, std::fs::Permissions::from_mode(0o755)));
    match direct {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => install_as_admin(&text)?,
        Err(err) => return Err(AppError::Internal(err.to_string())),
    }
    Ok(status())
}

#[cfg(not(target_os = "macos"))]
pub fn install() -> Result<ShellCommandStatus, AppError> {
    Err(AppError::Internal(
        "the shell command is installed only on macOS".into(),
    ))
}

/// Copies the script into place through `osascript`, which shows the system's password prompt.
#[cfg(target_os = "macos")]
fn install_as_admin(text: &str) -> Result<(), AppError> {
    let tmp = std::env::temp_dir().join(format!("git-sea-command-{}", std::process::id()));
    std::fs::write(&tmp, text).map_err(|err| AppError::Internal(err.to_string()))?;
    let quote = |s: &str| format!("'{}'", s.replace('\'', r"'\''"));
    let shell = format!(
        "mkdir -p /usr/local/bin && cp {tmp} {target} && chmod 755 {target}",
        tmp = quote(&tmp.display().to_string()),
        target = quote(TARGET),
    );
    // AppleScript string: backslashes and double quotes escaped.
    let apple = shell.replace('\\', "\\\\").replace('"', "\\\"");
    let prompt = crate::i18n::tr(
        "git-sea wants to install the git-sea command in /usr/local/bin.",
        "git-sea vuole installare il comando git-sea in /usr/local/bin.",
    );
    let output = crate::process::command("osascript")
        .arg("-e")
        .arg(format!(
            "do shell script \"{apple}\" with prompt \"{prompt}\" with administrator privileges"
        ))
        .output();
    let _ = std::fs::remove_file(&tmp);
    let output = output.map_err(|err| AppError::Internal(err.to_string()))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::Internal(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs the script with `open` replaced by `echo`, from `cwd`.
    #[cfg(unix)]
    fn run(script: &str, cwd: &Path, args: &[&str]) -> String {
        let dir = std::env::temp_dir().join(format!("git-sea-script-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("git-sea");
        std::fs::write(&file, script.replace("exec open", "exec echo")).unwrap();
        let out = std::process::Command::new("sh")
            .arg(&file)
            .args(args)
            .current_dir(cwd)
            .output()
            .unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        String::from_utf8(out.stdout).unwrap()
    }

    #[cfg(unix)]
    #[test]
    fn the_script_opens_absolute_paths_with_the_app() {
        let cwd = std::env::temp_dir().canonicalize().unwrap();
        let text = script(Path::new("/Applications/It's git-sea.app"));
        let pwd = cwd.display();
        assert_eq!(
            run(&text, &cwd, &[]),
            format!("-a /Applications/It's git-sea.app {pwd}/.\n")
        );
        assert_eq!(
            run(&text, &cwd, &["a b", "/abs"]),
            format!("-a /Applications/It's git-sea.app {pwd}/a b /abs\n")
        );
    }
}
