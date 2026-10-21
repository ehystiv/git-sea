//! Repositories asked for from outside the window: `git-sea <path>…` in a terminal (at launch, or
//! later through the single-instance plugin, which hands the arguments of a second launch to the
//! running app) and, on macOS, folders opened with the app (`open -a git-sea .`, which the
//! `git-sea` shell command uses, or a folder dropped on the Dock icon).
//!
//! The paths wait in `LaunchPaths` until the frontend takes them; `OPEN_PATHS_EVENT` only says
//! that there are new ones, so paths that arrive before the window listens are not lost.

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

/// Sent to the frontend when paths are waiting; it then calls `take_launch_paths`.
pub const OPEN_PATHS_EVENT: &str = "open-paths";

/// Paths waiting for the frontend, oldest first.
#[derive(Default)]
pub struct LaunchPaths(Mutex<Vec<String>>);

impl LaunchPaths {
    pub fn push(&self, paths: impl IntoIterator<Item = PathBuf>) {
        let mut waiting = self.lock();
        for path in paths {
            let path = path.display().to_string();
            if !waiting.contains(&path) {
                waiting.push(path);
            }
        }
    }

    pub fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.lock())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<String>> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// The repositories named by a command line: `args` without the program itself, resolved against
/// `cwd`, each taken up to the repository that holds it. Options (`-…`, like the `-psn_…` macOS
/// used to add) are skipped.
pub fn paths_from_args<S: Into<OsString>>(
    args: impl IntoIterator<Item = S>,
    cwd: &Path,
) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();
    for arg in args.into_iter().skip(1).map(Into::into) {
        if arg.to_string_lossy().starts_with('-') {
            continue;
        }
        let path = repository_root(&normalize(&cwd.join(arg)));
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    paths
}

/// `path` without `.` and `..`, worked out on the text: unlike `canonicalize`, it keeps symbolic
/// links as written and gives no `\\?\` prefix on Windows.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                // Never above the root.
                if matches!(out.components().next_back(), Some(Component::Normal(_))) {
                    out.pop();
                }
            }
            other => out.push(other),
        }
    }
    out
}

/// The repository that holds `path`: `path` or its closest ancestor that is one, so `git-sea .`
/// works from any folder of a working copy. `path` itself when none is, for the frontend to say
/// it is not a repository.
pub fn repository_root(path: &Path) -> PathBuf {
    path.ancestors()
        .find(|dir| crate::git::repo::looks_like_repo(dir))
        .unwrap_or(path)
        .to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("git-sea-launch-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn resolves_arguments_against_the_working_directory() {
        let dir = scratch("args");
        std::fs::create_dir_all(dir.join("repo/.git")).unwrap();
        std::fs::create_dir_all(dir.join("repo/src/deep")).unwrap();
        std::fs::create_dir_all(dir.join("plain")).unwrap();

        let args = [
            "git-sea",
            "-psn_0_123",
            "repo/src/deep",
            ".",
            "../plain",
            "repo",
        ];
        let paths = paths_from_args(args, &dir.join("repo"));
        assert_eq!(paths, [dir.join("repo"), dir.join("plain")]);

        let absolute = dir.join("repo/src").display().to_string();
        assert_eq!(
            paths_from_args(["git-sea", absolute.as_str()], Path::new("/")),
            [dir.join("repo")]
        );
        assert!(paths_from_args(["git-sea"], &dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_folder_outside_any_repository_is_kept_as_it_is() {
        let dir = scratch("none");
        assert_eq!(repository_root(&dir), dir);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn normalizes_dots_without_going_above_the_root() {
        assert_eq!(normalize(Path::new("/a/./b/../c")), Path::new("/a/c"));
        assert_eq!(normalize(Path::new("/../a")), Path::new("/a"));
    }

    #[test]
    fn waiting_paths_are_taken_once_without_duplicates() {
        let waiting = LaunchPaths::default();
        waiting.push([PathBuf::from("/a"), PathBuf::from("/b")]);
        waiting.push([PathBuf::from("/a")]);
        assert_eq!(waiting.take(), ["/a", "/b"]);
        assert!(waiting.take().is_empty());
    }
}
