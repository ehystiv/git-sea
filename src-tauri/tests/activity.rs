use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use git_sea_lib::git::activity::{ActivityCache, file_activity};
use git_sea_lib::git::commits::collect_refs;

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

/// Commit id -> sorted paths it changed, as the activity says.
fn by_commit(
    handle: &gix::ThreadSafeRepository,
    cache: &Mutex<ActivityCache>,
) -> Vec<(String, Vec<String>)> {
    let tips = collect_refs(&handle.to_thread_local()).unwrap().tips;
    let activity = file_activity(handle, tips, cache, false, &|| false, &|_, _| {})
        .unwrap()
        .unwrap();
    let mut out: Vec<(String, Vec<String>)> = activity
        .commits
        .iter()
        .map(|c| {
            let mut paths: Vec<String> = c
                .files
                .iter()
                .map(|&i| activity.paths[i as usize].clone())
                .collect();
            paths.sort();
            (c.id.clone(), paths)
        })
        .collect();
    out.sort();
    out
}

#[test]
fn lists_the_files_of_every_commit_but_merges() {
    let dir = fixture("merges.sh", "activity");
    let handle = gix::ThreadSafeRepository::open(&dir).unwrap();
    let cache = Mutex::new(ActivityCache::default());
    let found = by_commit(&handle, &cache);

    // As `git log --all --no-merges --name-only`.
    let log = git(
        &dir,
        &["log", "--all", "--no-merges", "--format=@%H", "--name-only"],
    );
    let mut expected: Vec<(String, Vec<String>)> = log
        .split('@')
        .filter(|chunk| !chunk.trim().is_empty())
        .map(|chunk| {
            let mut lines = chunk.lines().filter(|l| !l.is_empty());
            let id = lines.next().unwrap().to_owned();
            let mut paths: Vec<String> = lines.map(str::to_owned).collect();
            paths.sort();
            (id, paths)
        })
        .collect();
    expected.sort();
    assert_eq!(found, expected);
    assert!(!found.is_empty());

    // A second read only uses what the cache holds, and gives the same answer.
    let mut calls = 0;
    let tips = collect_refs(&handle.to_thread_local()).unwrap().tips;
    let progress = std::sync::Mutex::new(&mut calls);
    file_activity(&handle, tips, &cache, false, &|| false, &|_, _| {
        **progress.lock().unwrap() += 1
    })
    .unwrap();
    assert_eq!(calls, 0, "nothing new to read");
    assert_eq!(by_commit(&handle, &cache), expected);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_cancelled_read_returns_nothing() {
    let dir = fixture("merges.sh", "activity-cancel");
    let handle = gix::ThreadSafeRepository::open(&dir).unwrap();
    let cache = Mutex::new(ActivityCache::default());
    let tips = collect_refs(&handle.to_thread_local()).unwrap().tips;
    assert!(
        file_activity(&handle, tips, &cache, false, &|| true, &|_, _| {})
            .unwrap()
            .is_none()
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn counts_the_lines_of_each_file_when_asked() {
    let dir = fixture("diffs.sh", "activity-lines");
    let handle = gix::ThreadSafeRepository::open(&dir).unwrap();
    let cache = Mutex::new(ActivityCache::default());
    let tips = collect_refs(&handle.to_thread_local()).unwrap().tips;

    // Without lines first: the counts are not there, and asking for them reads the commits again.
    let plain = file_activity(&handle, tips.clone(), &cache, false, &|| false, &|_, _| {})
        .unwrap()
        .unwrap();
    assert!(plain.commits.iter().all(|c| c.added.is_none()));
    let activity = file_activity(&handle, tips, &cache, true, &|| false, &|_, _| {})
        .unwrap()
        .unwrap();

    // As `git log --numstat`, with binary files ("-") as 0.
    let log = git(
        &dir,
        &[
            "log",
            "--all",
            "--no-merges",
            "--no-renames",
            "--format=@%H",
            "--numstat",
        ],
    );
    let mut expected: Vec<(String, String, u32, u32)> = Vec::new();
    for chunk in log.split('@').filter(|c| !c.trim().is_empty()) {
        let mut lines = chunk.lines().filter(|l| !l.is_empty());
        let id = lines.next().unwrap().to_owned();
        for line in lines {
            let mut parts = line.split('\t');
            let added = parts.next().unwrap().parse().unwrap_or(0);
            let removed = parts.next().unwrap().parse().unwrap_or(0);
            expected.push((id.clone(), parts.next().unwrap().to_owned(), added, removed));
        }
    }
    let mut found: Vec<(String, String, u32, u32)> = activity
        .commits
        .iter()
        .flat_map(|c| {
            let added = c.added.clone().unwrap();
            let removed = c.removed.clone().unwrap();
            c.files
                .iter()
                .enumerate()
                .map(move |(i, &f)| (c.id.clone(), f, added[i], removed[i]))
        })
        .map(|(id, f, a, r)| (id, activity.paths[f as usize].clone(), a, r))
        .collect();
    expected.sort();
    found.sort();
    assert_eq!(found, expected);
    let _ = std::fs::remove_dir_all(&dir);
}
