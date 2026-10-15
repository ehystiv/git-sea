use std::path::{Path, PathBuf};
use std::process::Command;

use git_sea_lib::git::stash::list_stashes;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("git-sea-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn run_fixture(script: &str, dir: &Path) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(script);
    assert!(
        Command::new("sh")
            .arg(path)
            .arg(dir)
            .status()
            .unwrap()
            .success()
    );
}

#[test]
fn lists_stashes_newest_first_with_their_base_commit() {
    let dir = scratch("stash");
    run_fixture("stash.sh", &dir);
    let repo = gix::open(&dir).unwrap();

    let stashes = list_stashes(&repo).unwrap();

    assert_eq!(stashes.len(), 2);
    assert_eq!(stashes[0].index, 0);
    assert!(
        stashes[0].message.contains("named stash"),
        "{}",
        stashes[0].message
    );
    assert_eq!(stashes[1].index, 1);
    assert!(
        stashes[1].message.starts_with("WIP on main"),
        "{}",
        stashes[1].message
    );

    let head = repo.head_id().unwrap().to_string();
    assert!(
        stashes
            .iter()
            .all(|s| s.base.as_deref() == Some(head.as_str()))
    );
    assert_ne!(stashes[0].commit, stashes[1].commit);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_repository_without_stashes_gives_an_empty_list() {
    let dir = scratch("no-stash");
    run_fixture("basic.sh", &dir);
    let repo = gix::open(&dir).unwrap();

    assert!(list_stashes(&repo).unwrap().is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}
