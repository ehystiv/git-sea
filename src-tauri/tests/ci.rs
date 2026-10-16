use std::path::{Path, PathBuf};
use std::process::Command;

use git_sea_lib::ci::{self, CiProvider};
use git_sea_lib::git::commits::collect_refs;

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
fn reads_the_workflows_of_head_and_the_refs_they_run_on() {
    let dir = scratch("ci");
    run_fixture("ci.sh", &dir);
    let repo = gix::open(&dir).unwrap();
    let refs = collect_refs(&repo).unwrap();

    let overview = ci::overview(&repo, &refs.labels).unwrap();

    let names: Vec<(&str, CiProvider)> = overview
        .workflows
        .iter()
        .map(|w| (w.name.as_str(), w.provider))
        .collect();
    assert_eq!(
        names,
        [
            ("CI", CiProvider::GitHub),
            ("release", CiProvider::GitHub),
            ("GitLab CI", CiProvider::GitLab),
        ]
    );
    assert_eq!(
        overview.workflows[0].web_url.as_deref(),
        Some("https://github.com/owner/project/actions/workflows/ci.yml")
    );
    assert_eq!(overview.problems.len(), 1);
    assert_eq!(overview.problems[0].path, ".travis.yml");
    assert_eq!(overview.default_branch.as_deref(), Some("main"));

    let push = |name: &str| {
        overview
            .push
            .iter()
            .find(|t| t.name == name)
            .map(|t| t.workflows.clone())
            .unwrap_or_default()
    };
    assert_eq!(push("main"), [0]);
    assert_eq!(push("v1"), [1]);
    assert_eq!(push("feature"), [2]);

    let targets: Vec<&str> = overview
        .merge_targets
        .iter()
        .map(|t| t.name.as_str())
        .collect();
    assert_eq!(targets, ["main"]);
}

#[test]
fn a_repository_without_ci_files_has_no_workflows() {
    let dir = scratch("ci-none");
    run_fixture("basic.sh", &dir);
    let repo = gix::open(&dir).unwrap();
    let refs = collect_refs(&repo).unwrap();

    let overview = ci::overview(&repo, &refs.labels).unwrap();

    assert!(overview.workflows.is_empty());
    assert!(overview.push.is_empty());
    assert!(overview.problems.is_empty());
}
