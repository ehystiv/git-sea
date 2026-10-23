use std::path::{Path, PathBuf};
use std::process::Command;

use git_sea_lib::git::diff::merge_base;

fn fixture(script: &str, name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("git-sea-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(script);
    assert!(
        Command::new("sh")
            .arg(path)
            .arg(&dir)
            .status()
            .unwrap()
            .success()
    );
    dir
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .unwrap();
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}

#[test]
fn finds_the_common_ancestor_as_git_does() {
    let dir = fixture("merges.sh", "merge-base");
    let repo = gix::open(&dir).unwrap();
    for (a, b) in [("side", "main"), ("feature", "main~2^1"), ("a", "b")] {
        let (a, b) = (git(&dir, &["rev-parse", a]), git(&dir, &["rev-parse", b]));
        let expected = git(&dir, &["merge-base", &a, &b]);
        assert_eq!(merge_base(&repo, &a, &b).unwrap(), Some(expected.clone()));
        assert_eq!(merge_base(&repo, &b, &a).unwrap(), Some(expected));
    }
    // One side descending from the other: the base is the older one.
    let (main, side) = (
        git(&dir, &["rev-parse", "main~1"]),
        git(&dir, &["rev-parse", "side"]),
    );
    assert_eq!(merge_base(&repo, &main, &side).unwrap(), Some(main));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn unrelated_histories_have_no_base() {
    let dir = fixture("roots.sh", "merge-base-roots");
    let repo = gix::open(&dir).unwrap();
    let roots = git(&dir, &["rev-list", "--max-parents=0", "--all"]);
    let roots: Vec<&str> = roots.lines().collect();
    assert!(roots.len() >= 2, "the fixture has two root commits");
    assert_eq!(merge_base(&repo, roots[0], roots[1]).unwrap(), None);
    let _ = std::fs::remove_dir_all(&dir);
}
