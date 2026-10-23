use std::path::{Path, PathBuf};
use std::process::Command;

use git_sea_lib::git::tree::{EntryKind, file_content, list_files};

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

fn rev(repo: &gix::Repository, spec: &str) -> String {
    repo.rev_parse_single(spec).unwrap().to_string()
}

#[test]
fn lists_every_file_of_a_commit_with_its_kind() {
    let dir = scratch("tree-list");
    run_fixture("tree.sh", &dir);
    let repo = gix::open(&dir).unwrap();

    let first = list_files(&repo, &rev(&repo, "HEAD~1")).unwrap();
    let paths: Vec<&str> = first.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, ["README.md", "src/main.rs", "src/util/mod.rs"]);

    let second = list_files(&repo, &rev(&repo, "HEAD")).unwrap();
    let entries: Vec<(&str, EntryKind)> =
        second.iter().map(|f| (f.path.as_str(), f.kind)).collect();
    assert_eq!(
        entries,
        [
            ("README.md", EntryKind::File),
            ("link", EntryKind::Symlink),
            ("logo.bin", EntryKind::File),
            ("run.sh", EntryKind::Executable),
            ("src/main.rs", EntryKind::File),
            ("vendor", EntryKind::Submodule),
        ]
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn reads_a_file_as_it_was_in_a_commit() {
    let dir = scratch("tree-content");
    run_fixture("tree.sh", &dir);
    let repo = gix::open(&dir).unwrap();
    let head = rev(&repo, "HEAD");

    let readme = file_content(&repo, &head, "README.md").unwrap();
    assert_eq!(readme.lines, ["# Title", "", "Text"]);
    assert_eq!(readme.size, 16);
    assert!(!readme.binary && !readme.too_large);

    let link = file_content(&repo, &head, "link").unwrap();
    assert_eq!(
        (link.kind, link.lines.as_slice()),
        (EntryKind::Symlink, ["README.md".to_owned()].as_slice())
    );

    let logo = file_content(&repo, &head, "logo.bin").unwrap();
    assert!(logo.binary);
    assert!(logo.lines.is_empty());

    let vendor = file_content(&repo, &head, "vendor").unwrap();
    assert_eq!(vendor.kind, EntryKind::Submodule);
    assert_eq!(vendor.lines, ["1111111111111111111111111111111111111111"]);

    // Gone in HEAD, still there one commit earlier; a directory is not a file.
    assert!(file_content(&repo, &head, "src/util/mod.rs").is_err());
    let old = file_content(&repo, &rev(&repo, "HEAD~1"), "src/util/mod.rs").unwrap();
    assert_eq!(old.lines, ["pub fn util() {}"]);
    assert!(file_content(&repo, &head, "src").is_err());
    let _ = std::fs::remove_dir_all(&dir);
}
