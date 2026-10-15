use std::path::{Path, PathBuf};
use std::process::Command;

use git_sea_lib::git::commits::{CommitSummary, collect_refs, stream_commits};
use git_sea_lib::graph::lanes::{EdgeKind, GraphRow, validate_rows};

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
        .unwrap();
    assert!(status.success(), "{script} failed");
}

/// Streams a fixture repo and returns commits and rows, plus the layout width reported.
fn layout_of(script: &str, args: &[&str]) -> (Vec<CommitSummary>, Vec<GraphRow>, u32) {
    let dir = scratch(script);
    run_fixture(script, &dir, args);

    let repo = gix::open(&dir).unwrap();
    let tips = collect_refs(&repo).unwrap().tips;
    let (mut commits, mut rows) = (Vec::new(), Vec::new());
    let stats = stream_commits(&repo, tips, &|| false, &mut |c, r| {
        commits.extend(c);
        rows.extend(r);
        true
    })
    .unwrap();

    let _ = std::fs::remove_dir_all(&dir);
    (commits, rows, stats.max_lanes)
}

fn count(rows: &[GraphRow], kind: EdgeKind) -> usize {
    rows.iter()
        .flat_map(|r| &r.edges)
        .filter(|e| e.kind == kind)
        .count()
}

/// Every commit has one row, rows connect, and the edges account for every parent link.
fn assert_consistent(commits: &[CommitSummary], rows: &[GraphRow]) {
    assert_eq!(commits.len(), rows.len());
    assert_eq!(
        validate_rows(rows),
        Ok(0),
        "all lanes must be closed at the end"
    );

    let parent_links: usize = commits.iter().map(|c| c.parents.len()).sum();
    let leaving = count(rows, EdgeKind::Out) + count(rows, EdgeKind::ForkOut);
    let arriving = count(rows, EdgeKind::In) + count(rows, EdgeKind::MergeIn);
    assert_eq!(leaving, parent_links);
    // A parent reached by several lanes counts once per lane, so arrivals can only exceed links
    // by the number of extra lanes that were already waiting for the same commit.
    assert!(arriving >= parent_links.saturating_sub(count(rows, EdgeKind::ForkOut)));
}

#[test]
fn merges_and_octopus_fixture() {
    let (commits, rows, max_lanes) = layout_of("merges.sh", &[]);

    assert_consistent(&commits, &rows);
    let octopus = commits
        .iter()
        .position(|c| c.summary == "Octopus merge")
        .unwrap();
    let forks = rows[octopus]
        .edges
        .iter()
        .filter(|e| e.kind == EdgeKind::ForkOut)
        .count();
    assert_eq!(forks, 3, "an octopus merge forks out once per extra parent");
    assert!(max_lanes >= 4);
}

#[test]
fn crossing_branches_fixture() {
    let (commits, rows, max_lanes) = layout_of("crossing.sh", &[]);

    assert_consistent(&commits, &rows);
    assert!(max_lanes >= 3, "a, b and main are open together");
}

#[test]
fn multiple_roots_fixture() {
    let (commits, rows, _) = layout_of("roots.sh", &[]);

    assert_consistent(&commits, &rows);
    let roots = commits.iter().filter(|c| c.parents.is_empty()).count();
    assert_eq!(roots, 2);
}

#[test]
fn long_linear_history_uses_one_lane() {
    let (commits, rows, max_lanes) = layout_of("linear.sh", &["600"]);

    assert_consistent(&commits, &rows);
    assert_eq!(max_lanes, 1);
    assert!(rows.iter().all(|r| r.lane == 0 && r.color == 0));
}
