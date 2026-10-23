use std::path::{Path, PathBuf};
use std::process::Command;

use git_sea_lib::git::blame::blame_file;
use git_sea_lib::git::commits::{CommitSummary, collect_refs, stream_commits};
use git_sea_lib::git::diff::commit_details;

fn fixture(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("git-sea-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/mailmap.sh");
    assert!(
        Command::new("sh")
            .arg(script)
            .arg(&dir)
            .status()
            .unwrap()
            .success()
    );
    dir
}

fn commits(repo: &gix::Repository) -> Vec<CommitSummary> {
    let tips = collect_refs(repo).unwrap().tips;
    let mut all = Vec::new();
    stream_commits(repo, tips, &|| false, &mut |c, _| {
        all.extend(c);
        true
    })
    .unwrap();
    all
}

#[test]
fn authors_are_named_as_the_mailmap_says() {
    let dir = fixture("mailmap_walk");
    let repo = gix::open(&dir).unwrap();
    let authors: Vec<String> = commits(&repo).into_iter().map(|c| c.author).collect();
    assert_eq!(authors, ["Bruno", "Anna Rossi", "Anna Rossi"]);

    // Without the mailmap the old name is back.
    std::fs::remove_file(dir.join(".mailmap")).unwrap();
    let authors: Vec<String> = commits(&repo).into_iter().map(|c| c.author).collect();
    assert_eq!(authors, ["Bruno", "Anna Rossi", "anna"]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn co_authors_are_named_as_the_mailmap_says() {
    let dir = fixture("mailmap_co_authors");
    let repo = gix::open(&dir).unwrap();
    let all = commits(&repo);
    let co: Vec<Option<Vec<String>>> = all.iter().map(|c| c.co_authors.clone()).collect();
    assert_eq!(co, [Some(vec!["Anna Rossi".to_owned()]), None, None]);

    let details = commit_details(&repo, &all[0].id, None).unwrap();
    assert_eq!(details.co_authors.len(), 1);
    assert_eq!(details.co_authors[0].name, "Anna Rossi");
    assert_eq!(details.co_authors[0].email, "anna@example.com");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn details_and_blame_use_the_mailmap() {
    let dir = fixture("mailmap_details");
    let repo = gix::open(&dir).unwrap();
    let first = commits(&repo).pop().unwrap();
    let details = commit_details(&repo, &first.id, None).unwrap();
    assert_eq!(details.author.name, "Anna Rossi");
    assert_eq!(details.author.email, "anna@example.com");
    assert_eq!(details.committer.name, "Anna Rossi");

    let blame = blame_file(&repo, &first.id, "file.txt").unwrap();
    assert_eq!(blame.commits[0].author, "Anna Rossi");
    let _ = std::fs::remove_dir_all(&dir);
}
