use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use git_sea_lib::git::commits::{RefFilter, RefKind, collect_refs, stream_commits};
use git_sea_lib::git::search::{SearchField, search_commits};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("git-sea-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn run_fixture(script: &str, dir: &Path) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(script);
    let status = Command::new("sh")
        .arg(path)
        .arg(dir)
        .status()
        .expect("failed to run fixture script");
    assert!(status.success(), "{script} failed");
}

/// Summaries of the commits with the given ids.
fn summaries(repo: &gix::Repository, ids: &[String]) -> HashSet<String> {
    ids.iter()
        .map(|id| {
            let id = gix::ObjectId::from_hex(id.as_bytes()).unwrap();
            let commit = repo.find_commit(id).unwrap();
            commit.message().unwrap().summary().to_string()
        })
        .collect()
}

fn set(items: &[&str]) -> HashSet<String> {
    items.iter().map(|s| (*s).to_owned()).collect()
}

fn search(dir: &Path, field: SearchField, text: &str) -> HashSet<String> {
    let repo = gix::open(dir).unwrap();
    let tips = collect_refs(&repo).unwrap().tips;
    let result = search_commits(&repo, tips, field, text, &|| false).unwrap();
    assert!(!result.truncated && !result.cancelled);
    summaries(&repo, &result.ids)
}

#[test]
fn path_search_finds_the_commits_that_changed_a_file_against_their_first_parent() {
    let dir = scratch("search-path");
    run_fixture("merges.sh", &dir);

    // The merge brings f1.txt into main, so its first-parent diff touches the file too.
    assert_eq!(
        search(&dir, SearchField::Path, "f1.txt"),
        set(&["f1", "Merge feature"])
    );
    assert_eq!(
        search(&dir, SearchField::Path, "./a1.txt"),
        set(&["a1", "Octopus merge"])
    );
    assert_eq!(search(&dir, SearchField::Path, "base.txt"), set(&["base"]));
    assert!(search(&dir, SearchField::Path, "missing.txt").is_empty());
    assert!(search(&dir, SearchField::Path, "  ").is_empty());
    assert!(search(&dir, SearchField::Message, "").is_empty());
}

#[test]
fn path_search_matches_directories() {
    let dir = scratch("search-dir");
    run_fixture("merges.sh", &dir);
    std::fs::create_dir_all(dir.join("docs/guide")).unwrap();
    std::fs::write(dir.join("docs/guide/intro.md"), "hi").unwrap();
    for args in [
        &["add", "docs"][..],
        &["commit", "-q", "-m", "Add the guide"],
    ] {
        let status = Command::new("git")
            .arg("-C")
            .arg(&dir)
            .args(args)
            .status()
            .unwrap();
        assert!(status.success());
    }

    assert_eq!(
        search(&dir, SearchField::Path, "docs/"),
        set(&["Add the guide"])
    );
    assert_eq!(
        search(&dir, SearchField::Path, "docs/guide"),
        set(&["Add the guide"])
    );
}

#[test]
fn message_search_is_case_insensitive_and_reads_the_whole_message() {
    let dir = scratch("search-message");
    run_fixture("merges.sh", &dir);
    assert_eq!(
        search(&dir, SearchField::Message, "OCTOPUS"),
        set(&["Octopus merge"])
    );
    assert_eq!(
        search(&dir, SearchField::Message, "merge"),
        set(&["Merge feature", "Octopus merge"])
    );
}

#[test]
fn a_cancelled_search_stops_early() {
    let dir = scratch("search-cancel");
    run_fixture("merges.sh", &dir);
    let repo = gix::open(&dir).unwrap();
    let tips = collect_refs(&repo).unwrap().tips;
    let result = search_commits(&repo, tips, SearchField::Message, "merge", &|| true).unwrap();
    assert!(result.cancelled);
    assert!(result.ids.is_empty());
}

fn walked(dir: &Path, only: Option<&[RefFilter]>) -> HashSet<String> {
    let repo = gix::open(dir).unwrap();
    let tips = collect_refs(&repo).unwrap().tips_for(only);
    let mut ids = Vec::new();
    stream_commits(&repo, tips, &|| false, &mut |c, _| {
        ids.extend(c.into_iter().map(|c| c.id));
        true
    })
    .unwrap();
    summaries(&repo, &ids)
}

fn filter(kind: RefKind, name: &str) -> RefFilter {
    RefFilter {
        kind,
        name: name.to_owned(),
    }
}

#[test]
fn the_branch_filter_walks_only_the_chosen_refs() {
    let dir = scratch("filter");
    run_fixture("merges.sh", &dir);

    assert_eq!(walked(&dir, None).len(), 11);
    assert_eq!(
        walked(&dir, Some(&[filter(RefKind::Branch, "feature")])),
        set(&["base", "f1", "f2"])
    );
    // `side` starts from main~1, so it holds everything up to m2.
    assert_eq!(
        walked(&dir, Some(&[filter(RefKind::Branch, "side")])),
        set(&["base", "f1", "f2", "m1", "Merge feature", "m2", "s1"])
    );
    // HEAD is on main: a filter saved as a plain branch still finds it, and the other way round.
    let main = walked(&dir, Some(&[filter(RefKind::Branch, "main")]));
    assert_eq!(main.len(), 10);
    assert_eq!(walked(&dir, Some(&[filter(RefKind::Head, "main")])), main);
    // Several refs together.
    let both = walked(
        &dir,
        Some(&[
            filter(RefKind::Branch, "feature"),
            filter(RefKind::Branch, "a"),
        ]),
    );
    assert_eq!(
        both,
        set(&["base", "f1", "f2", "m1", "Merge feature", "a1"])
    );
    // A ref that no longer exists gives an empty graph, not the whole history.
    assert!(walked(&dir, Some(&[filter(RefKind::Branch, "gone")])).is_empty());
}
