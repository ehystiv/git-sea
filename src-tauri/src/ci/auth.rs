//! Tokens for the CI services' APIs: the ones the GitHub and GitLab CLIs (`gh`, `glab`) are
//! logged in with, or one saved from the app in the system keychain (the macOS Keychain, the
//! Secret Service on Linux, the Credential Manager on Windows). Tokens never leave this module
//! except as an HTTP header to the service they belong to.

use std::process::Stdio;

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
    let path = crate::process::find(program)?;
    let output = crate::process::command(path)
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
        CiProvider::GitHub => crate::process::find("gh").is_some(),
        CiProvider::GitLab => crate::process::find("glab").is_some(),
        _ => false,
    }
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

/// The system store as keyring-core's default, set up once: the Secret Service (GNOME Keyring,
/// KWallet) on Linux, the Credential Manager on Windows.
#[cfg(any(target_os = "linux", target_os = "windows"))]
fn keyring_entry(provider: CiProvider) -> Result<keyring_core::Entry, String> {
    static STORE: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
    STORE
        .get_or_init(|| {
            #[cfg(target_os = "linux")]
            let store = zbus_secret_service_keyring_store::Store::new();
            #[cfg(target_os = "windows")]
            let store = windows_native_keyring_store::Store::new();
            store
                .map(|store| keyring_core::set_default_store(store))
                .map_err(|e| {
                    format!(
                        "{}: {e}",
                        crate::i18n::tr("keychain not available", "portachiavi non disponibile")
                    )
                })
        })
        .clone()?;
    keyring_core::Entry::new(KEYCHAIN_SERVICE, provider.key()).map_err(|e| e.to_string())
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub fn keychain_get(provider: CiProvider) -> Option<String> {
    let token = keyring_entry(provider).ok()?.get_password().ok()?;
    (!token.is_empty()).then_some(token)
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub fn keychain_set(provider: CiProvider, token: &str) -> Result<(), String> {
    keyring_entry(provider)?
        .set_password(token)
        .map_err(|e| e.to_string())
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub fn keychain_delete(provider: CiProvider) -> Result<(), String> {
    match keyring_entry(provider)?.delete_credential() {
        // Nothing saved: nothing to delete.
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
pub fn keychain_get(_provider: CiProvider) -> Option<String> {
    None
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
pub fn keychain_set(_provider: CiProvider, _token: &str) -> Result<(), String> {
    Err(crate::i18n::tr(
        "the keychain is only available on macOS, Linux and Windows",
        "il portachiavi è disponibile solo su macOS, Linux e Windows",
    ))
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
pub fn keychain_delete(_provider: CiProvider) -> Result<(), String> {
    Ok(())
}
