use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

use git_sea_lib::git::fetch::{Fetcher, fetch};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("git-sea-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args([
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.com",
        ])
        .args(["-c", "commit.gpgsign=false"])
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}

/// An "upstream" repository with one commit, and a clone of it.
fn upstream_and_clone(name: &str) -> (PathBuf, PathBuf) {
    let upstream = scratch(&format!("{name}-upstream"));
    let clone = scratch(&format!("{name}-clone"));
    std::fs::create_dir_all(&upstream).unwrap();
    git(&upstream, &["init", "-q", "-b", "main"]);
    git(&upstream, &["commit", "-q", "--allow-empty", "-m", "first"]);
    let parent = clone.parent().unwrap();
    git(
        parent,
        &[
            "clone",
            "-q",
            upstream.to_str().unwrap(),
            clone.to_str().unwrap(),
        ],
    );
    (upstream, clone)
}

#[test]
fn brings_new_remote_commits_without_touching_local_branches() {
    let (upstream, clone) = upstream_and_clone("fetch-new");
    git(
        &upstream,
        &["commit", "-q", "--allow-empty", "-m", "second"],
    );
    let local_before = git(&clone, &["rev-parse", "main"]);

    fetch(&clone).unwrap();

    assert_eq!(
        git(&clone, &["rev-parse", "origin/main"]),
        git(&upstream, &["rev-parse", "main"])
    );
    assert_eq!(git(&clone, &["rev-parse", "main"]), local_before);
}

#[test]
fn reports_what_git_said_when_the_remote_is_gone() {
    let (upstream, clone) = upstream_and_clone("fetch-gone");
    std::fs::remove_dir_all(&upstream).unwrap();
    let error = fetch(&clone).unwrap_err();
    assert!(!error.is_empty());
}

#[test]
fn fetches_as_soon_as_it_starts_and_tells_how_it_went() {
    let (upstream, clone) = upstream_and_clone("fetcher");
    git(
        &upstream,
        &["commit", "-q", "--allow-empty", "-m", "second"],
    );

    let (tx, rx) = mpsc::channel();
    let fetcher = Fetcher::start(&gix::open(&clone).unwrap(), move || {
        let _ = tx.send(());
    });
    // One notification when it starts, one when it ends.
    for _ in 0..2 {
        rx.recv_timeout(Duration::from_secs(30))
            .expect("fetch state change");
    }
    let state = fetcher.state();
    assert!(state.has_remotes && !state.running);
    assert!(state.last_success_ms.is_some() && state.last_error.is_none());
    assert_eq!(
        git(&clone, &["rev-parse", "origin/main"]),
        git(&upstream, &["rev-parse", "main"])
    );

    // A fetch on request, without waiting for the next round.
    git(&upstream, &["commit", "-q", "--allow-empty", "-m", "third"]);
    fetcher.fetch_now();
    for _ in 0..2 {
        rx.recv_timeout(Duration::from_secs(30))
            .expect("fetch state change");
    }
    assert_eq!(
        git(&clone, &["rev-parse", "origin/main"]),
        git(&upstream, &["rev-parse", "main"])
    );
}

#[test]
fn a_repository_without_remotes_is_left_alone() {
    let dir = scratch("fetch-no-remotes");
    std::fs::create_dir_all(&dir).unwrap();
    git(&dir, &["init", "-q"]);
    let (tx, rx) = mpsc::channel();
    let fetcher = Fetcher::start(&gix::open(&dir).unwrap(), move || {
        let _ = tx.send(());
    });
    assert!(rx.recv_timeout(Duration::from_millis(500)).is_err());
    assert!(!fetcher.state().has_remotes);
}
