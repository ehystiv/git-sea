use std::path::{Path, PathBuf};
use std::process::Command;

use git_sea_lib::git::diff::{ChangeStatus, FileChange, LineKind};
use git_sea_lib::git::worktree::{worktree_diff, worktree_status};

fn fixture(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("git-sea-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worktree.sh");
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

fn listed(files: &[FileChange]) -> Vec<(&str, ChangeStatus)> {
    files.iter().map(|f| (f.path.as_str(), f.status)).collect()
}

#[test]
fn lists_staged_and_unstaged_changes_like_git_status() {
    let dir = fixture("lists_staged_and_unstaged_changes_like_git_status");
    let status = worktree_status(&gix::open(&dir).unwrap()).unwrap();

    assert!(status.head.is_some());
    assert_eq!(
        listed(&status.staged),
        [
            ("both.txt", ChangeStatus::Modified),
            ("new.txt", ChangeStatus::Added),
            ("staged.txt", ChangeStatus::Modified),
        ]
    );
    assert_eq!(
        listed(&status.unstaged),
        [
            ("both.txt", ChangeStatus::Modified),
            ("gone.txt", ChangeStatus::Deleted),
            ("unstaged.txt", ChangeStatus::Modified),
            ("untracked.txt", ChangeStatus::Added),
        ]
    );
    // both.txt is staged and unstaged, but it is one file.
    assert_eq!(status.files, 6);

    let both_staged = &status.staged[0];
    assert_eq!(
        (both_staged.additions, both_staged.deletions),
        (Some(1), Some(1))
    );
    let both_unstaged = &status.unstaged[0];
    assert_eq!(
        (both_unstaged.additions, both_unstaged.deletions),
        (Some(1), Some(0))
    );
}

#[test]
fn a_clean_working_copy_has_nothing_to_show() {
    let dir = fixture("a_clean_working_copy_has_nothing_to_show");
    for args in [&["add", "-A"][..], &["commit", "-q", "-m", "all"][..]] {
        assert!(
            Command::new("git")
                .arg("-C")
                .arg(&dir)
                .args(args)
                .status()
                .unwrap()
                .success()
        );
    }
    let status = worktree_status(&gix::open(&dir).unwrap()).unwrap();
    assert!(status.staged.is_empty() && status.unstaged.is_empty());
    assert_eq!(status.files, 0);
}

#[test]
fn diffs_the_index_against_head_or_the_disk_against_the_index() {
    let dir = fixture("diffs_the_index_against_head_or_the_disk_against_the_index");
    let repo = gix::open(&dir).unwrap();

    let staged = worktree_diff(&repo, "both.txt", None, true).unwrap();
    let changed: Vec<_> = staged.hunks[0]
        .lines
        .iter()
        .filter(|l| l.kind != LineKind::Context)
        .map(|l| (l.kind, l.text.as_str()))
        .collect();
    assert_eq!(changed, [(LineKind::Del, "two"), (LineKind::Add, "TWO")]);

    let unstaged = worktree_diff(&repo, "both.txt", None, false).unwrap();
    let added: Vec<_> = unstaged.hunks[0]
        .lines
        .iter()
        .filter(|l| l.kind == LineKind::Add)
        .map(|l| l.text.as_str())
        .collect();
    assert_eq!(added, ["three"]);

    let untracked = worktree_diff(&repo, "untracked.txt", None, false).unwrap();
    assert_eq!(untracked.hunks[0].lines.len(), 1);
    let gone = worktree_diff(&repo, "gone.txt", None, false).unwrap();
    assert!(gone.hunks[0].lines.iter().all(|l| l.kind == LineKind::Del));
}

#[test]
fn a_linked_worktree_has_its_own_changes() {
    let dir = fixture("a_linked_worktree_has_its_own_changes");
    let linked = dir.with_file_name(format!(
        "{}-linked",
        dir.file_name().unwrap().to_string_lossy()
    ));
    let _ = std::fs::remove_dir_all(&linked);
    for args in [&["add", "-A"][..], &["commit", "-q", "-m", "all"][..]] {
        assert!(
            Command::new("git")
                .arg("-C")
                .arg(&dir)
                .args(args)
                .status()
                .unwrap()
                .success()
        );
    }
    assert!(
        Command::new("git")
            .arg("-C")
            .arg(&dir)
            .args(["worktree", "add", "-q", "-b", "other"])
            .arg(&linked)
            .status()
            .unwrap()
            .success()
    );
    std::fs::write(
        linked.join("staged.txt"),
        "changed in the linked worktree\n",
    )
    .unwrap();

    let main = worktree_status(&gix::open(&dir).unwrap()).unwrap();
    let other = worktree_status(&gix::open(&linked).unwrap()).unwrap();
    assert_eq!(main.files, 0);
    assert_eq!(
        listed(&other.unstaged),
        [("staged.txt", ChangeStatus::Modified)]
    );
    let _ = std::fs::remove_dir_all(&linked);
}
