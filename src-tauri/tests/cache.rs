use std::path::{Path, PathBuf};
use std::process::Command;

use git_sea_lib::cache::{self, CachedGraph, Fingerprint};
use git_sea_lib::git::commits::{CommitSummary, collect_refs, stream_cached, stream_commits};
use git_sea_lib::graph::lanes::{GraphRow, validate_rows};

type Chunks = Vec<(Vec<CommitSummary>, Vec<GraphRow>)>;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("git-sea-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn run_fixture(script: &str, dir: &Path, args: &[&str]) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(script);
    assert!(
        Command::new("sh")
            .arg(path)
            .arg(dir)
            .args(args)
            .status()
            .unwrap()
            .success()
    );
}

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}");
}

/// Walks the repository the way a first load does, keeping the chunks as they were sent.
fn walk(repo: &gix::Repository) -> (Chunks, CachedGraph, Fingerprint) {
    let snapshot = collect_refs(repo).unwrap();
    let fingerprint = Fingerprint::of(&snapshot.labels);
    let mut chunks: Chunks = Vec::new();
    let stats = stream_commits(repo, snapshot.tips, &|| false, &mut |c, r| {
        chunks.push((c, r));
        true
    })
    .unwrap();
    let graph = CachedGraph {
        commits: chunks.iter().flat_map(|(c, _)| c.clone()).collect(),
        rows: chunks.iter().flat_map(|(_, r)| r.clone()).collect(),
        max_lanes: stats.max_lanes,
    };
    (chunks, graph, fingerprint)
}

#[test]
fn a_cached_graph_streams_exactly_like_a_walk() {
    let dir = scratch("cache-same");
    run_fixture("linear.sh", &dir, &["600"]);
    let repo = gix::open(&dir).unwrap();
    let (walked, graph, fingerprint) = walk(&repo);

    let file = cache::path_for(&scratch("cache-same-dir"), repo.git_dir());
    cache::store(&file, &fingerprint, &graph).unwrap();
    let loaded = cache::load(&file, &fingerprint).expect("fresh cache");

    let mut cached: Chunks = Vec::new();
    let stats = stream_cached(&loaded, &|| false, &mut |c, r| {
        cached.push((c, r));
        true
    });

    assert_eq!(cached, walked, "same chunks, same content");
    assert_eq!(
        cached.iter().map(|(c, _)| c.len()).collect::<Vec<_>>(),
        [256, 344]
    );
    assert!(stats.from_cache);
    assert_eq!(stats.total, 600);
    assert_eq!(stats.max_lanes, graph.max_lanes);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_cached_merge_history_keeps_a_valid_layout() {
    let dir = scratch("cache-merges");
    run_fixture("merges.sh", &dir, &[]);
    let repo = gix::open(&dir).unwrap();
    let (_, graph, fingerprint) = walk(&repo);

    let file = cache::path_for(&scratch("cache-merges-dir"), repo.git_dir());
    cache::store(&file, &fingerprint, &graph).unwrap();
    let loaded = cache::load(&file, &fingerprint).unwrap();

    assert_eq!(loaded, graph);
    assert_eq!(validate_rows(&loaded.rows), Ok(0));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_new_commit_or_branch_invalidates_the_cache() {
    let dir = scratch("cache-stale");
    run_fixture("basic.sh", &dir, &[]);
    let repo = gix::open(&dir).unwrap();
    let (_, graph, fingerprint) = walk(&repo);
    let file = cache::path_for(&scratch("cache-stale-dir"), repo.git_dir());
    cache::store(&file, &fingerprint, &graph).unwrap();

    git(&dir, &["branch", "another"]);
    let after_branch = Fingerprint::of(&collect_refs(&gix::open(&dir).unwrap()).unwrap().labels);
    assert!(cache::load(&file, &after_branch).is_none(), "new branch");

    // Same refs again: valid. Then a commit moves `main`: stale.
    git(&dir, &["branch", "-D", "another"]);
    let restored = Fingerprint::of(&collect_refs(&gix::open(&dir).unwrap()).unwrap().labels);
    assert!(
        cache::load(&file, &restored).is_some(),
        "back to the original refs"
    );
    git(&dir, &["commit", "--allow-empty", "-q", "-m", "more"]);
    let after_commit = Fingerprint::of(&collect_refs(&gix::open(&dir).unwrap()).unwrap().labels);
    assert!(cache::load(&file, &after_commit).is_none(), "main moved");
    let _ = std::fs::remove_dir_all(&dir);
}
