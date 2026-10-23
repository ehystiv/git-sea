use std::path::{Path, PathBuf};
use std::process::Command;

use git_sea_lib::git::cleanup::{cleanup_report, ls_remote_heads};

fn fixture(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("git-sea-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cleanup.sh");
    assert!(
        Command::new("sh")
            .arg(script)
            .arg(&dir)
            .status()
            .unwrap()
            .success()
    );
    dir
}

fn names(list: &[git_sea_lib::git::cleanup::CleanupRef]) -> Vec<&str> {
    list.iter().map(|r| r.name.as_str()).collect()
}

#[test]
fn finds_what_could_be_cleaned_up() {
    let dir = fixture("cleanup");
    let work = dir.join("work");
    let repo = gix::open(&work).unwrap();
    let report = cleanup_report(&repo, &|remote| ls_remote_heads(&work, remote)).unwrap();

    assert_eq!(names(&report.gone_remote), ["origin/old"]);
    assert_eq!(names(&report.gone_upstream), ["old"]);
    assert_eq!(names(&report.no_upstream), ["local-only", "merged"]);
    assert_eq!(names(&report.merged), ["keep", "merged"]);
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_remote_that_cannot_be_reached_is_reported() {
    let dir = fixture("cleanup-offline");
    let repo = gix::open(dir.join("work")).unwrap();
    let report = cleanup_report(&repo, &|_| Err("unreachable".to_owned())).unwrap();
    assert!(report.gone_remote.is_empty());
    assert_eq!(report.errors, ["origin: unreachable"]);
    // What needs no remote is still there.
    assert_eq!(names(&report.merged), ["keep", "merged"]);
    let _ = std::fs::remove_dir_all(&dir);
}
