//! Running the external programs git-sea uses (`git`, `gh`, `glab`, the browser) the same way on
//! macOS, Linux and Windows.

use std::ffi::OsStr;
use std::path::PathBuf;
use std::process::{Command, Stdio};

/// Searched after PATH: an app started from the Finder or a desktop launcher gets a minimal one.
#[cfg(not(windows))]
const EXTRA_DIRS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
#[cfg(windows)]
const EXTRA_DIRS: &[&str] = &[
    r"C:\Program Files\Git\cmd",
    r"C:\Program Files\GitHub CLI",
    r"C:\Program Files\glab",
];

/// The file name of the program `name`: `name.exe` on Windows.
pub fn executable_name(name: &str, windows: bool) -> String {
    if windows {
        format!("{name}.exe")
    } else {
        name.to_owned()
    }
}

/// Every installed copy of `name`, in the order they are tried: PATH first.
pub fn candidates(name: &str) -> impl Iterator<Item = PathBuf> {
    let file = executable_name(name, cfg!(windows));
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::split_paths(&path)
        .collect::<Vec<_>>()
        .into_iter()
        .chain(EXTRA_DIRS.iter().map(PathBuf::from))
        .map(move |dir| dir.join(&file))
        .filter(|p| p.is_file())
}

/// The first installed copy of `name`.
pub fn find(name: &str) -> Option<PathBuf> {
    candidates(name).next()
}

/// A command for `program` that, on Windows, does not open a console window.
pub fn command(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Opens `url` in the default browser.
pub fn open_url(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut open = {
        let mut c = command("/usr/bin/open");
        c.arg(url);
        c
    };
    #[cfg(windows)]
    let mut open = {
        let mut c = command("rundll32");
        c.args(["url.dll,FileProtocolHandler", url]);
        c
    };
    #[cfg(not(any(target_os = "macos", windows)))]
    let mut open = {
        let mut c = command("xdg-open");
        c.arg(url);
        c
    };
    open.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn programs_end_in_exe_only_on_windows() {
        assert_eq!(executable_name("git", true), "git.exe");
        assert_eq!(executable_name("git", false), "git");
    }
}
