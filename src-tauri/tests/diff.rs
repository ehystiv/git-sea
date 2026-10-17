use std::path::{Path, PathBuf};
use std::process::Command;

use git_sea_lib::error::AppError;
use git_sea_lib::git::diff::{ChangeStatus, LineKind, commit_details, file_diff};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("git-sea-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn fixture(name: &str) -> PathBuf {
    let dir = scratch(name);
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/diffs.sh");
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

/// Hex id of the commit with the given summary.
fn commit_named(dir: &Path, summary: &str) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["log", "--all", "--format=%H %s"])
        .output()
        .unwrap();
    String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .find_map(|l| {
            l.split_once(' ')
                .filter(|(_, s)| *s == summary)
                .map(|(h, _)| h.to_owned())
        })
        .unwrap_or_else(|| panic!("no commit named {summary}"))
}

#[test]
fn root_commit_lists_everything_as_added_with_statistics() {
    let dir = fixture("root_commit_lists_everything_as_added_with_statistics");
    let repo = gix::open(&dir).unwrap();

    let details = commit_details(&repo, &commit_named(&dir, "add"), None).unwrap();

    assert_eq!(details.summary, "add");
    assert_eq!(details.compared_with, None);
    assert!(details.parents.is_empty());
    assert_eq!(details.author.name, "Fixture");
    let names: Vec<_> = details.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(names, ["a.txt", "b.txt", "image.bin"]);
    assert!(
        details
            .files
            .iter()
            .all(|f| f.status == ChangeStatus::Added)
    );
    assert_eq!(details.files[0].additions, Some(3));
    assert_eq!(details.files[0].deletions, Some(0));
    assert!(details.files[2].binary);
    assert_eq!(details.files[2].additions, None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn modification_counts_changed_lines() {
    let dir = fixture("modification_counts_changed_lines");
    let repo = gix::open(&dir).unwrap();

    let details = commit_details(&repo, &commit_named(&dir, "modify"), None).unwrap();

    assert_eq!(details.files.len(), 1);
    let file = &details.files[0];
    assert_eq!(
        (file.path.as_str(), file.status),
        ("a.txt", ChangeStatus::Modified)
    );
    // "two" → "TWO" is one removal and one addition, plus the appended "four".
    assert_eq!((file.additions, file.deletions), (Some(2), Some(1)));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn rename_and_delete_are_reported() {
    let dir = fixture("rename_and_delete_are_reported");
    let repo = gix::open(&dir).unwrap();

    let details = commit_details(&repo, &commit_named(&dir, "rename"), None).unwrap();

    let renamed = details
        .files
        .iter()
        .find(|f| f.path == "dir/c.txt")
        .unwrap();
    assert_eq!(renamed.status, ChangeStatus::Renamed);
    assert_eq!(renamed.old_path.as_deref(), Some("b.txt"));
    assert_eq!((renamed.additions, renamed.deletions), (Some(1), Some(1)));
    let deleted = details.files.iter().find(|f| f.path == "a.txt").unwrap();
    assert_eq!(deleted.status, ChangeStatus::Deleted);
    assert_eq!(deleted.deletions, Some(4));

    // The rename diff is taken between the old and the new path.
    let diff = file_diff(&repo, &details.id, "dir/c.txt", Some("b.txt"), None).unwrap();
    let changed: Vec<_> = diff
        .hunks
        .iter()
        .flat_map(|h| &h.lines)
        .filter(|l| l.kind != LineKind::Context)
        .map(|l| l.text.as_str())
        .collect();
    assert_eq!(changed, ["theta", "THETA"]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn merge_is_compared_with_its_first_parent() {
    let dir = fixture("merge_is_compared_with_its_first_parent");
    let repo = gix::open(&dir).unwrap();

    let details = commit_details(&repo, &commit_named(&dir, "Merge side"), None).unwrap();

    assert_eq!(details.parents.len(), 2);
    assert_eq!(
        details.compared_with.as_deref(),
        Some(details.parents[0].as_str())
    );
    // First parent is "main work", so the merge brings in side.txt only.
    let names: Vec<_> = details.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(names, ["side.txt"]);
    assert_eq!(details.body, "Body line one.\n\nBody line two.");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn merge_can_be_compared_with_its_second_parent() {
    let dir = fixture("merge_can_be_compared_with_its_second_parent");
    let repo = gix::open(&dir).unwrap();
    let merge = commit_named(&dir, "Merge side");
    let second = commit_named(&dir, "side work");

    let details = commit_details(&repo, &merge, Some(&second)).unwrap();

    assert_eq!(details.compared_with.as_deref(), Some(second.as_str()));
    // Seen from the side branch, the merge brings in what main did.
    let names: Vec<_> = details.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(names, ["main.txt"]);
    let diff = file_diff(&repo, &merge, "main.txt", None, Some(&second)).unwrap();
    assert_eq!(diff.hunks[0].lines[0].text, "main");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn any_two_commits_can_be_compared() {
    let dir = fixture("any_two_commits_can_be_compared");
    let repo = gix::open(&dir).unwrap();
    let from = commit_named(&dir, "add");
    let to = commit_named(&dir, "rename");

    let details = commit_details(&repo, &to, Some(&from)).unwrap();

    // Two commits apart: a.txt is gone and b.txt became dir/c.txt.
    let files: Vec<_> = details
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.status))
        .collect();
    assert_eq!(
        files,
        [
            ("a.txt", ChangeStatus::Deleted),
            ("dir/c.txt", ChangeStatus::Renamed)
        ]
    );
    let diff = file_diff(&repo, &to, "a.txt", None, Some(&from)).unwrap();
    let removed: Vec<_> = diff.hunks[0]
        .lines
        .iter()
        .map(|l| l.text.as_str())
        .collect();
    assert_eq!(removed, ["one", "two", "three"]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn file_diff_has_line_numbers_on_both_sides() {
    let dir = fixture("file_diff_has_line_numbers_on_both_sides");
    let repo = gix::open(&dir).unwrap();
    let id = commit_named(&dir, "modify");

    let diff = file_diff(&repo, &id, "a.txt", None, None).unwrap();

    assert!(!diff.binary && !diff.truncated);
    assert_eq!(diff.hunks.len(), 1);
    let lines = &diff.hunks[0].lines;
    let del = lines.iter().find(|l| l.kind == LineKind::Del).unwrap();
    assert_eq!(
        (del.text.as_str(), del.old_no, del.new_no),
        ("two", Some(2), None)
    );
    let adds: Vec<_> = lines
        .iter()
        .filter(|l| l.kind == LineKind::Add)
        .map(|l| (l.text.as_str(), l.new_no))
        .collect();
    assert_eq!(adds, [("TWO", Some(2)), ("four", Some(4))]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn binary_files_have_no_hunks() {
    let dir = fixture("binary_files_have_no_hunks");
    let repo = gix::open(&dir).unwrap();

    let diff = file_diff(&repo, &commit_named(&dir, "add"), "image.bin", None, None).unwrap();

    assert!(diff.binary);
    assert!(diff.hunks.is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn bad_ids_are_reported_as_git_errors() {
    let dir = fixture("bad_ids_are_reported_as_git_errors");
    let repo = gix::open(&dir).unwrap();

    assert!(matches!(
        commit_details(&repo, "not-hex", None),
        Err(AppError::Git(_))
    ));
    let missing = "0123456789abcdef0123456789abcdef01234567";
    assert!(matches!(
        commit_details(&repo, missing, None),
        Err(AppError::Git(_))
    ));
    let _ = std::fs::remove_dir_all(&dir);
}
