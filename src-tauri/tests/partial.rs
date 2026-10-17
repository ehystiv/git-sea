use std::path::{Path, PathBuf};
use std::process::Command;

use git_sea_lib::error::AppError;
use git_sea_lib::git::commits::collect_refs;
use git_sea_lib::git::repo::{in_partial_clone, is_partial_clone};
use git_sea_lib::git::search::{SearchField, search_commits};

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

/// A repository with some history, and a treeless clone of it that has none of the old trees.
fn upstream_and_treeless_clone(name: &str) -> (PathBuf, PathBuf) {
    let upstream = scratch(&format!("{name}-upstream"));
    let clone = scratch(&format!("{name}-clone"));
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/merges.sh");
    assert!(
        Command::new("sh")
            .arg(script)
            .arg(&upstream)
            .status()
            .unwrap()
            .success()
    );
    git(&upstream, &["config", "uploadpack.allowFilter", "true"]);
    let url = format!("file://{}", upstream.display());
    git(
        clone.parent().unwrap(),
        &[
            "clone",
            "-q",
            "--no-checkout",
            "--filter=tree:0",
            &url,
            clone.to_str().unwrap(),
        ],
    );
    (upstream, clone)
}

#[test]
fn a_treeless_clone_is_recognised_and_its_missing_trees_reported_as_such() {
    let (upstream, clone) = upstream_and_treeless_clone("partial");
    let full = gix::open(&upstream).unwrap();
    let partial = gix::open(&clone).unwrap();
    assert!(!is_partial_clone(&full));
    assert!(is_partial_clone(&partial));

    let tips = collect_refs(&partial).unwrap().tips;
    let err = search_commits(&partial, tips, SearchField::Path, "a1.txt", &|| false).unwrap_err();
    assert!(
        matches!(in_partial_clone(&partial, err), AppError::MissingObjects(_)),
        "a missing tree in a partial clone"
    );
    // The message search reads only commits, which a treeless clone has.
    let tips = collect_refs(&partial).unwrap().tips;
    assert!(search_commits(&partial, tips, SearchField::Message, "merge", &|| false).is_ok());

    // In a complete repository a git error stays a git error.
    let other = in_partial_clone(&full, AppError::Git("x".into()));
    assert!(matches!(other, AppError::Git(_)));

    let _ = std::fs::remove_dir_all(&upstream);
    let _ = std::fs::remove_dir_all(&clone);
}
