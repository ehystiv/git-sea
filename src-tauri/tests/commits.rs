use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;

use git_sea_lib::git::commits::{
    CHUNK_SIZE, CommitSummary, FIRST_CHUNK_SIZE, RefKind, collect_refs, stream_commits,
};

// The second chunk of `sends_a_small_first_chunk_then_big_ones` must fit in one regular chunk.
const _: () = assert!(344 < CHUNK_SIZE);

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("git-sea-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn run_fixture(script: &str, dir: &Path, args: &[&str]) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(script);
    let status = Command::new("sh")
        .arg(path)
        .arg(dir)
        .args(args)
        .status()
        .expect("failed to run fixture script");
    assert!(status.success(), "{script} failed");
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(out.status.success());
    String::from_utf8(out.stdout).unwrap()
}

fn load(dir: &Path) -> Vec<Vec<CommitSummary>> {
    let repo = gix::open(dir).unwrap();
    let tips = collect_refs(&repo).unwrap().tips;
    let mut chunks = Vec::new();
    stream_commits(&repo, tips, &|| false, &mut |c, _rows| {
        chunks.push(c);
        true
    })
    .unwrap();
    chunks
}

#[test]
fn topological_order_covers_all_branches_and_tags() {
    let dir = scratch("merges");
    run_fixture("merges.sh", &dir, &[]);

    let commits: Vec<CommitSummary> = load(&dir).into_iter().flatten().collect();

    // Same commit set as `git rev-list` over branches, tags and HEAD.
    let expected: HashSet<String> = git(&dir, &["rev-list", "--branches", "--tags", "HEAD"])
        .lines()
        .map(str::to_owned)
        .collect();
    let got: HashSet<String> = commits.iter().map(|c| c.id.clone()).collect();
    assert_eq!(commits.len(), got.len(), "no commit may be sent twice");
    assert_eq!(got, expected);

    // Children always come before their parents.
    let position: HashMap<&str, usize> = commits
        .iter()
        .enumerate()
        .map(|(i, c)| (c.id.as_str(), i))
        .collect();
    for (i, commit) in commits.iter().enumerate() {
        for parent in &commit.parents {
            assert!(
                position[parent.as_str()] > i,
                "{} before its parent",
                commit.summary
            );
        }
    }

    let octopus = commits
        .iter()
        .find(|c| c.summary == "Octopus merge")
        .unwrap();
    assert_eq!(octopus.parents.len(), 4);
    assert_eq!(octopus.author, "Fixture");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn sends_a_small_first_chunk_then_big_ones() {
    let dir = scratch("linear");
    let total = FIRST_CHUNK_SIZE + 344;
    run_fixture("linear.sh", &dir, &[&total.to_string()]);

    let sizes: Vec<usize> = load(&dir).iter().map(Vec::len).collect();

    assert_eq!(sizes, vec![FIRST_CHUNK_SIZE, 344]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn newest_commit_comes_first_in_a_linear_history() {
    let dir = scratch("linear-order");
    run_fixture("linear.sh", &dir, &["30"]);

    let commits: Vec<CommitSummary> = load(&dir).into_iter().flatten().collect();

    assert_eq!(commits.first().unwrap().summary, "commit 30");
    assert_eq!(commits.last().unwrap().summary, "commit 1");
    assert!(commits.last().unwrap().parents.is_empty());
    assert_eq!(commits.first().unwrap().time, 1_700_000_030);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stops_when_cancelled() {
    let dir = scratch("cancel");
    run_fixture("linear.sh", &dir, &["600"]);
    let repo = gix::open(&dir).unwrap();
    let tips = collect_refs(&repo).unwrap().tips;

    let polls = Cell::new(0);
    let mut sent = 0;
    let stats = stream_commits(
        &repo,
        tips,
        &|| {
            polls.set(polls.get() + 1);
            polls.get() > 300
        },
        &mut |chunk, _rows| {
            sent += chunk.len();
            true
        },
    )
    .unwrap();

    assert_eq!(
        sent, FIRST_CHUNK_SIZE,
        "only the chunk completed before cancelling is sent"
    );
    assert!(stats.total < 600);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stops_when_the_receiver_is_gone() {
    let dir = scratch("receiver-gone");
    run_fixture("linear.sh", &dir, &["600"]);
    let repo = gix::open(&dir).unwrap();
    let tips = collect_refs(&repo).unwrap().tips;

    let mut calls = 0;
    stream_commits(&repo, tips, &|| false, &mut |_, _| {
        calls += 1;
        false
    })
    .unwrap();

    assert_eq!(calls, 1);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn labels_name_branches_remotes_tags_and_head() {
    let dir = scratch("labels");
    run_fixture("merges.sh", &dir, &[]);
    let repo = gix::open(&dir).unwrap();

    let snapshot = collect_refs(&repo).unwrap();

    let find = |name: &str| snapshot.labels.iter().find(|l| l.name == name);
    assert_eq!(find("main").unwrap().kind, RefKind::Head);
    assert_eq!(find("feature").unwrap().kind, RefKind::Branch);
    assert_eq!(find("v1").unwrap().kind, RefKind::Tag);
    // The annotated tag is peeled to the commit it marks, which is part of the walk.
    let tagged = git(&dir, &["rev-parse", "v1^{commit}"]).trim().to_owned();
    assert_eq!(find("v1").unwrap().commit, tagged);
    let tagged_id = gix::ObjectId::from_hex(tagged.as_bytes()).unwrap();
    assert!(snapshot.tips.contains(&tagged_id));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_clone_lists_each_remote_branch_once_despite_origin_head() {
    let source = scratch("clone-source");
    run_fixture("basic.sh", &source, &[]);
    let clone = scratch("clone-copy");
    let status = Command::new("git")
        .args(["clone", "-q"])
        .arg(&source)
        .arg(&clone)
        .status()
        .unwrap();
    assert!(status.success());
    // Packed refs plus a loose ref that overrides the packed one, as after a fetch.
    git(&clone, &["pack-refs", "--all"]);
    git(
        &clone,
        &["update-ref", "refs/remotes/origin/main", "HEAD~1"],
    );
    let repo = gix::open(&clone).unwrap();

    let labels = collect_refs(&repo).unwrap().labels;

    let mut names: Vec<_> = labels
        .iter()
        .filter(|l| l.kind == RefKind::Remote)
        .map(|l| l.name.as_str())
        .collect();
    names.sort_unstable();
    // Without the fix `origin/HEAD` showed up as a second `origin/main`.
    assert_eq!(names, ["origin/feature", "origin/main"]);
    let main = labels.iter().find(|l| l.name == "origin/main").unwrap();
    let expected = git(&clone, &["rev-parse", "HEAD~1"]).trim().to_owned();
    assert_eq!(
        main.commit, expected,
        "the loose ref overrides the packed one"
    );
    let _ = std::fs::remove_dir_all(&source);
    let _ = std::fs::remove_dir_all(&clone);
}
