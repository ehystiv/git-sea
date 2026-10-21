use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

use git_sea_lib::watcher::RepoWatcher;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("git-sea-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Watching a real repository: file system events take a moment to arrive, so waits are generous.
#[test]
fn reports_ref_changes_and_ignores_everything_else() {
    let dir = scratch("watch");
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/basic.sh");
    assert!(
        Command::new("sh")
            .arg(script)
            .arg(&dir)
            .status()
            .unwrap()
            .success()
    );
    let repo = gix::open(&dir).unwrap();

    let (tx, rx) = mpsc::channel();
    let _watcher = RepoWatcher::start(repo.git_dir(), repo.common_dir(), move || {
        let _ = tx.send(());
    })
    .expect("watcher");
    // Let the watcher settle, then drop anything the fixture's own writes left behind.
    std::thread::sleep(Duration::from_millis(800));
    while rx.recv_timeout(Duration::from_millis(600)).is_ok() {}

    // Staging a file only touches the index and objects: no notification.
    std::fs::write(dir.join("new.txt"), "x").unwrap();
    git(&dir, &["add", "new.txt"]);
    assert!(
        rx.recv_timeout(Duration::from_millis(1500)).is_err(),
        "index and objects are noise"
    );

    // A new branch is a new ref.
    git(&dir, &["branch", "topic"]);
    assert!(
        rx.recv_timeout(Duration::from_secs(6)).is_ok(),
        "new branch"
    );
    while rx.recv_timeout(Duration::from_millis(600)).is_ok() {}

    // A commit moves the branch ref (and touches several files, which count once).
    git(&dir, &["commit", "-q", "-m", "more"]);
    assert!(rx.recv_timeout(Duration::from_secs(6)).is_ok(), "commit");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stops_when_dropped() {
    let dir = scratch("watch-drop");
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/basic.sh");
    assert!(
        Command::new("sh")
            .arg(script)
            .arg(&dir)
            .status()
            .unwrap()
            .success()
    );
    let repo = gix::open(&dir).unwrap();

    let (tx, rx) = mpsc::channel();
    let watcher = RepoWatcher::start(repo.git_dir(), repo.common_dir(), move || {
        let _ = tx.send(());
    })
    .expect("watcher");
    std::thread::sleep(Duration::from_millis(800));
    while rx.recv_timeout(Duration::from_millis(600)).is_ok() {}
    drop(watcher);

    git(&dir, &["branch", "after-drop"]);
    assert!(
        rx.recv_timeout(Duration::from_secs(2)).is_err(),
        "no events after the watcher is gone"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A linked worktree's index lives in the main repository's `.git/worktrees/<name>`, outside the
/// worktree's own files: staging there must still be reported.
#[test]
fn reports_staging_in_a_linked_worktree() {
    let dir = scratch("watch-linked-main");
    let linked = scratch("watch-linked");
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/basic.sh");
    assert!(
        Command::new("sh")
            .arg(script)
            .arg(&dir)
            .status()
            .unwrap()
            .success()
    );
    git(
        &dir,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "linked",
            linked.to_str().unwrap(),
        ],
    );
    let path = linked.join("staged.txt");
    std::fs::write(&path, "new\n").unwrap();

    let repo = gix::open(&linked).unwrap();
    let (tx, rx) = mpsc::channel();
    let _watcher = RepoWatcher::start_worktree(
        repo.workdir().unwrap(),
        repo.git_dir(),
        move || {
            let _ = tx.send(());
        },
        || {},
    )
    .expect("watcher");
    std::thread::sleep(Duration::from_millis(800));
    while rx.recv_timeout(Duration::from_millis(600)).is_ok() {}

    // Only the index changes: the file was written before watching started.
    git(&linked, &["add", "staged.txt"]);
    assert!(
        rx.recv_timeout(Duration::from_secs(5)).is_ok(),
        "staging in the linked worktree was not reported"
    );
    let _ = std::fs::remove_dir_all(&linked);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn editing_the_mailmap_is_reported_apart() {
    let dir = scratch("watch-mailmap");
    std::fs::create_dir_all(&dir).unwrap();
    git(&dir, &["init", "-q", "-b", "main"]);
    let repo = gix::open(&dir).unwrap();
    let (tx, rx) = mpsc::channel();
    let _watcher = RepoWatcher::start_worktree(
        repo.workdir().unwrap(),
        repo.git_dir(),
        || {},
        move || {
            let _ = tx.send(());
        },
    )
    .expect("watcher");
    std::thread::sleep(Duration::from_millis(800));
    while rx.recv_timeout(Duration::from_millis(600)).is_ok() {}

    std::fs::write(dir.join("other.txt"), "x\n").unwrap();
    assert!(
        rx.recv_timeout(Duration::from_millis(1500)).is_err(),
        "another file counted as the mailmap"
    );
    std::fs::write(dir.join(".mailmap"), "Anna <anna@example.com>\n").unwrap();
    assert!(
        rx.recv_timeout(Duration::from_secs(5)).is_ok(),
        "editing .mailmap was not reported"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
