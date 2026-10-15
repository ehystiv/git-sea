use std::path::{Path, PathBuf};
use std::process::Command;

use git_sea_lib::error::AppError;
use git_sea_lib::git::repo::{self, HeadInfo};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("git-sea-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn basic_fixture(dir: &Path) {
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/basic.sh");
    let status = Command::new("sh")
        .arg(script)
        .arg(dir)
        .status()
        .expect("failed to run fixture script");
    assert!(status.success());
}

#[test]
fn opens_basic_repo() {
    let dir = scratch("basic");
    basic_fixture(&dir);

    let info = repo::open(&dir, "s1".into()).expect("repo should open").0;

    assert!(info.name.starts_with("git-sea-test-"));
    assert_eq!(info.session_id, "s1");
    assert!(!info.is_bare);
    // refs/heads/main, refs/heads/feature, refs/tags/v0.1.0
    assert_eq!(info.ref_count, 3);
    match info.head {
        HeadInfo::Branch { name, commit } => {
            assert_eq!(name, "main");
            assert_eq!(commit.len(), 40);
        }
        other => panic!("unexpected head: {other:?}"),
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn reports_unborn_head_on_fresh_repo() {
    let dir = scratch("unborn");
    std::fs::create_dir_all(&dir).unwrap();
    gix::init(&dir).expect("init");

    let info = repo::open(&dir, "s1".into()).expect("repo should open").0;

    assert_eq!(info.ref_count, 0);
    assert!(matches!(info.head, HeadInfo::Unborn { .. }));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn rejects_plain_directory() {
    let dir = scratch("plain");
    std::fs::create_dir_all(&dir).unwrap();

    let err = repo::open(&dir, "s1".into()).unwrap_err();

    assert!(matches!(err, AppError::NotARepository(_)), "got {err:?}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn rejects_missing_path() {
    let err = repo::open(&scratch("missing"), "s1".into()).unwrap_err();
    assert!(matches!(err, AppError::PathNotFound(_)), "got {err:?}");
}
