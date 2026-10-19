use std::path::{Path, PathBuf};
use std::process::Command;

use git_sea_lib::git::blame::blame_file;

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

fn head(repo: &gix::Repository) -> String {
    repo.head_id().unwrap().to_string()
}

#[test]
fn blame_names_the_commit_of_every_line_across_a_rename() {
    let dir = scratch("blame-rename");
    run_fixture("renames.sh", &dir);
    let repo = gix::open(&dir).unwrap();

    let blame = blame_file(&repo, &head(&repo), "new.txt").unwrap();

    assert_eq!(blame.lines, ["a", "B", "c", "d"]);
    let summary = |id: &str| {
        blame
            .commits
            .iter()
            .find(|c| c.id == id)
            .map(|c| c.summary.clone())
            .unwrap()
    };
    let per_line: Vec<(String, Option<String>)> = blame
        .hunks
        .iter()
        .flat_map(|h| (0..h.len).map(move |_| (h.commit.clone(), h.source_path.clone())))
        .map(|(id, path)| (summary(&id), path))
        .collect();
    let old = Some("old.txt".to_owned());
    assert_eq!(
        per_line,
        [
            ("create".to_owned(), old.clone()),
            ("edit".to_owned(), old.clone()),
            ("create".to_owned(), old),
            ("after".to_owned(), None),
        ]
    );
    // Hunks cover the file in order, and each commit is listed once.
    assert_eq!(blame.hunks.iter().map(|h| h.len).sum::<u32>(), 4);
    assert!(blame.hunks.windows(2).all(|w| w[0].start < w[1].start));
    assert_eq!(blame.commits.len(), 3);
}

#[test]
fn blame_of_a_missing_file_is_an_error_and_binaries_are_flagged() {
    let dir = scratch("blame-binary");
    run_fixture("diffs.sh", &dir);
    let repo = gix::open(&dir).unwrap();

    assert!(blame_file(&repo, &head(&repo), "nope.txt").is_err());
    let binary = blame_file(&repo, &head(&repo), "image.bin").unwrap();
    assert!(binary.binary && binary.lines.is_empty() && binary.hunks.is_empty());
}
