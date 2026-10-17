use std::path::{Path, PathBuf};
use std::process::Command;

use git_sea_lib::git::upstream::{Upstream, list_upstreams};

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

fn upstream(branch: &str, upstream: &str) -> Upstream {
    Upstream {
        branch: branch.to_owned(),
        upstream: upstream.to_owned(),
    }
}

#[test]
fn maps_local_branches_to_their_remote_tracking_branches() {
    let dir = scratch("upstream");
    run_fixture("upstream.sh", &dir);
    let repo = gix::open(&dir).unwrap();

    let upstreams = list_upstreams(&repo).unwrap();

    assert_eq!(
        upstreams,
        vec![
            upstream("main", "origin/main"),
            upstream("topic", "origin/renamed")
        ]
    );
}

#[test]
fn a_repository_without_remotes_has_no_upstreams() {
    let dir = scratch("upstream-none");
    run_fixture("stash.sh", &dir);
    let repo = gix::open(&dir).unwrap();

    assert!(list_upstreams(&repo).unwrap().is_empty());
}
