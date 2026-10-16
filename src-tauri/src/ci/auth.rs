//! Tokens for the CI services' APIs: the ones the GitHub and GitLab CLIs (`gh`, `glab`) are
//! logged in with, or one saved in the macOS Keychain from the app. Tokens never leave this
//! module except as an HTTP header to the service they belong to.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use specta::Type;

use super::CiProvider;

/// Keychain service the tokens are saved under; the account is the provider's key.
const KEYCHAIN_SERVICE: &str = "git-sea";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
pub enum CiAuthSource {
    /// The provider's command line tool (`gh`, `glab`).
    Cli,
    Keychain,
    /// No token: only public projects can be read.
    Anonymous,
}

/// The token to call `provider` on `host` with, and where it came from. The CLI wins over the
/// Keychain, so logging in or out there is reflected here.
pub fn token(provider: CiProvider, host: &str) -> Option<(String, CiAuthSource)> {
    if let Some(token) = cli_token(provider, host) {
        return Some((token, CiAuthSource::Cli));
    }
    keychain_get(provider).map(|t| (t, CiAuthSource::Keychain))
}

fn cli_token(provider: CiProvider, host: &str) -> Option<String> {
    let (program, args): (&str, Vec<&str>) = match provider {
        CiProvider::GitHub => ("gh", vec!["auth", "token", "--hostname", host]),
        CiProvider::GitLab => ("glab", vec!["config", "get", "token", "--host", host]),
        _ => return None,
    };
    let path = find_program(program)?;
    let output = Command::new(path)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let token = String::from_utf8(output.stdout).ok()?.trim().to_owned();
    (!token.is_empty() && !token.contains(char::is_whitespace)).then_some(token)
}

/// Whether the provider's command line tool is installed, for a hint in the UI.
pub fn has_cli(provider: CiProvider) -> bool {
    match provider {
        CiProvider::GitHub => find_program("gh").is_some(),
        CiProvider::GitLab => find_program("glab").is_some(),
        _ => false,
    }
}

/// An app started from the Finder gets a minimal PATH, so the usual install places are tried too.
fn find_program(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::split_paths(&path)
        .chain(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from))
        .map(|dir| dir.join(name))
        .find(|p| Path::is_file(p))
}

#[cfg(target_os = "macos")]
pub fn keychain_get(provider: CiProvider) -> Option<String> {
    let bytes =
        security_framework::passwords::get_generic_password(KEYCHAIN_SERVICE, provider.key())
            .ok()?;
    String::from_utf8(bytes).ok().filter(|t| !t.is_empty())
}

#[cfg(target_os = "macos")]
pub fn keychain_set(provider: CiProvider, token: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(
        KEYCHAIN_SERVICE,
        provider.key(),
        token.as_bytes(),
    )
    .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
pub fn keychain_delete(provider: CiProvider) -> Result<(), String> {
    match security_framework::passwords::delete_generic_password(KEYCHAIN_SERVICE, provider.key()) {
        Ok(()) => Ok(()),
        // Nothing saved: nothing to delete.
        Err(e) if e.code() == -25300 => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn keychain_get(_provider: CiProvider) -> Option<String> {
    None
}

#[cfg(not(target_os = "macos"))]
pub fn keychain_set(_provider: CiProvider, _token: &str) -> Result<(), String> {
    Err("il portachiavi è disponibile solo su macOS".to_owned())
}

#[cfg(not(target_os = "macos"))]
pub fn keychain_delete(_provider: CiProvider) -> Result<(), String> {
    Ok(())
}
