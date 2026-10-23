//! On-disk cache of a repository's graph (commits and lane layout).
//!
//! Walking and laying out 50k commits takes a few hundred milliseconds; reading the result back
//! from a file is faster still. A cache file is only trusted when the refs and the mailmap it was
//! built from are exactly those the repository has now, so a new commit, branch, tag or deletion,
//! or an edited `.mailmap`, makes it stale and the graph is built again.
//!
//! Each file starts with the git directory it belongs to, so `sweep` can drop the files of
//! repositories that are gone by reading only the first bytes.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::git::commits::{CommitSummary, RefKind, RefLabel};
use crate::git::mailmap::Mailmap;
use crate::graph::lanes::GraphRow;

/// Bump when the file layout or the lane algorithm changes: older files are then ignored (and
/// removed by `sweep`).
const FORMAT_VERSION: u32 = 4;
/// Smaller histories load instantly, so they are not worth a file.
pub const MIN_CACHED_COMMITS: usize = 1_000;
/// Files kept in the cache directory; the least recently written go first.
const MAX_FILES: usize = 30;
const EXTENSION: &str = "graph";

/// What the graph was built from: every ref with the commit it pointed to, in a fixed order, and
/// the mailmap that named the authors. Compared whole rather than hashed, so a stale file can
/// never pass for a fresh one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fingerprint {
    refs: Vec<(u8, String, String)>,
    mailmap: Vec<String>,
}

impl Fingerprint {
    pub fn of(labels: &[RefLabel]) -> Self {
        let kind = |k: RefKind| match k {
            RefKind::Head => 0,
            RefKind::Branch => 1,
            RefKind::Remote => 2,
            RefKind::Tag => 3,
        };
        let mut entries: Vec<_> = labels
            .iter()
            .map(|l| (kind(l.kind), l.name.clone(), l.commit.clone()))
            .collect();
        entries.sort();
        Self {
            refs: entries,
            mailmap: Vec::new(),
        }
    }

    /// The same refs, with the authors named by `mailmap`.
    #[must_use]
    pub fn with_mailmap(mut self, mailmap: &Mailmap) -> Self {
        self.mailmap = crate::git::mailmap::entries(mailmap);
        self
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CachedGraph {
    pub commits: Vec<CommitSummary>,
    pub rows: Vec<GraphRow>,
    pub max_lanes: u32,
}

#[derive(Serialize)]
struct FileRef<'a> {
    version: u32,
    git_dir: &'a str,
    fingerprint: &'a Fingerprint,
    graph: &'a CachedGraph,
}

#[derive(Deserialize)]
struct File {
    version: u32,
    git_dir: String,
    fingerprint: Fingerprint,
    graph: CachedGraph,
}

/// The start of a file: postcard writes fields in order, so it decodes from the first bytes alone.
#[derive(Deserialize)]
struct Header {
    version: u32,
    git_dir: String,
}

/// Bytes read to find a file's header; far more than any path needs.
const HEADER_BYTES: usize = 8 * 1024;

/// 64-bit FNV-1a: stable across runs and Rust versions, which `DefaultHasher` does not promise.
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, &b| {
        (hash ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

/// The cache file of the repository whose git directory is `git_dir`.
pub fn path_for(cache_dir: &Path, git_dir: &Path) -> PathBuf {
    let key = fnv1a(git_dir.to_string_lossy().as_bytes());
    cache_dir.join(format!("{key:016x}.{EXTENSION}"))
}

/// The cached graph, if the file exists, is readable, belongs to `git_dir` and was built from
/// exactly `fingerprint`. A file that cannot be decoded is deleted.
pub fn load(path: &Path, git_dir: &Path, fingerprint: &Fingerprint) -> Option<CachedGraph> {
    let bytes = fs::read(path).ok()?;
    let file: File = match postcard::from_bytes(&bytes) {
        Ok(file) => file,
        Err(err) => {
            tracing::warn!(%err, path = %path.display(), "discarding unreadable graph cache");
            let _ = fs::remove_file(path);
            return None;
        }
    };
    (file.version == FORMAT_VERSION
        && file.git_dir == git_dir.to_string_lossy()
        && file.fingerprint == *fingerprint)
        .then_some(file.graph)
}

/// Writes the cache file of the repository at `git_dir` (through a temporary file, so a crash
/// never leaves a half-written one).
pub fn store(
    path: &Path,
    git_dir: &Path,
    fingerprint: &Fingerprint,
    graph: &CachedGraph,
) -> io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(dir)?;
    let git_dir = git_dir.to_string_lossy();
    let bytes = postcard::to_allocvec(&FileRef {
        version: FORMAT_VERSION,
        git_dir: &git_dir,
        fingerprint,
        graph,
    })
    .map_err(io::Error::other)?;

    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut file = fs::File::create(&tmp)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    fs::rename(&tmp, path)?;
    prune(dir);
    Ok(())
}

/// Keeps the directory from growing without bound: the oldest files beyond `MAX_FILES` go.
fn prune(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<_> = entries
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x == EXTENSION))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    files.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    for (_, path) in files.into_iter().skip(MAX_FILES) {
        let _ = fs::remove_file(path);
    }
}

/// What the cache directory holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CacheUsage {
    pub files: u32,
    #[specta(type = f64)]
    pub bytes: u64,
}

fn graph_files(dir: &Path) -> Vec<fs::DirEntry> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x == EXTENSION))
        .collect()
}

pub fn usage(dir: &Path) -> CacheUsage {
    graph_files(dir)
        .iter()
        .fold(CacheUsage::default(), |usage, entry| CacheUsage {
            files: usage.files + 1,
            bytes: usage.bytes + entry.metadata().map(|m| m.len()).unwrap_or(0),
        })
}

/// The git directory a cache file belongs to, if it is a file of the current format.
fn owner(path: &Path) -> Option<PathBuf> {
    use std::io::Read;
    let mut start = Vec::with_capacity(HEADER_BYTES);
    fs::File::open(path)
        .ok()?
        .take(HEADER_BYTES as u64)
        .read_to_end(&mut start)
        .ok()?;
    let (header, _) = postcard::take_from_bytes::<Header>(&start).ok()?;
    (header.version == FORMAT_VERSION).then(|| PathBuf::from(header.git_dir))
}

/// Removes what can no longer be used: files of repositories that are gone, files of an older
/// format or unreadable, and temporary files left by a crash. Returns how many files went.
pub fn sweep(dir: &Path) -> u32 {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let leftover =
            name.contains(".tmp-") && !name.ends_with(&format!(".tmp-{}", std::process::id()));
        let dead = path.extension().is_some_and(|x| x == EXTENSION)
            && !owner(&path).is_some_and(|git_dir| git_dir.exists());
        if (leftover || dead) && fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// Removes every cache file; graphs are then built again on the next load.
pub fn clear(dir: &Path) -> io::Result<u32> {
    let mut removed = 0;
    for entry in graph_files(dir) {
        fs::remove_file(entry.path())?;
        removed += 1;
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::lanes::LaneLayout;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("git-sea-cache-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn label(name: &str, commit: &str, kind: RefKind) -> RefLabel {
        RefLabel {
            commit: commit.to_owned(),
            name: name.to_owned(),
            kind,
        }
    }

    fn graph() -> CachedGraph {
        let commit = |id: &str, parents: &[&str]| CommitSummary {
            id: id.to_owned(),
            summary: format!("commit {id}"),
            author: "Ada".to_owned(),
            time: 1_700_000_000,
            parents: parents.iter().map(|p| (*p).to_owned()).collect(),
            co_authors: (id == "b").then(|| vec!["Grace".to_owned()]),
        };
        let commits = vec![
            commit("c", &["a", "b"]),
            commit("b", &["a"]),
            commit("a", &[]),
        ];
        let mut layout = LaneLayout::new();
        let rows = commits
            .iter()
            .map(|c| {
                let parents: Vec<&str> = c.parents.iter().map(String::as_str).collect();
                layout.push(c.id.as_str(), &parents)
            })
            .collect::<Vec<_>>();
        let max_lanes = u32::try_from(layout.max_width()).unwrap();
        CachedGraph {
            commits,
            rows,
            max_lanes,
        }
    }

    #[test]
    fn a_stored_graph_comes_back_unchanged() {
        let dir = scratch("roundtrip");
        let git_dir = Path::new("/repos/a/.git");
        let path = path_for(&dir, git_dir);
        let print = Fingerprint::of(&[label("main", "c", RefKind::Head)]);

        store(&path, git_dir, &print, &graph()).unwrap();

        assert_eq!(load(&path, git_dir, &print), Some(graph()));
        // A file under the name of another repository (a hash collision) is not trusted.
        assert!(load(&path, Path::new("/repos/z/.git"), &print).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn any_change_to_the_refs_makes_the_cache_stale() {
        let dir = scratch("stale");
        let git_dir = Path::new("/repos/a/.git");
        let path = path_for(&dir, git_dir);
        let refs = [
            label("main", "c", RefKind::Head),
            label("v1", "a", RefKind::Tag),
        ];
        store(&path, git_dir, &Fingerprint::of(&refs), &graph()).unwrap();

        // The same refs in another order are the same repository state.
        let reordered = [refs[1].clone(), refs[0].clone()];
        assert!(load(&path, git_dir, &Fingerprint::of(&reordered)).is_some());

        // A moved ref, a new ref and a deleted ref are all different.
        let moved = [label("main", "b", RefKind::Head), refs[1].clone()];
        assert!(load(&path, git_dir, &Fingerprint::of(&moved)).is_none());
        let added = [
            refs[0].clone(),
            refs[1].clone(),
            label("x", "a", RefKind::Branch),
        ];
        assert!(load(&path, git_dir, &Fingerprint::of(&added)).is_none());
        assert!(load(&path, git_dir, &Fingerprint::of(&refs[..1])).is_none());
        // The same name as another kind is not the same ref either.
        let retyped = [label("main", "c", RefKind::Branch), refs[1].clone()];
        assert!(load(&path, git_dir, &Fingerprint::of(&retyped)).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_new_mailmap_makes_the_cache_stale() {
        let dir = scratch("mailmap");
        let git_dir = Path::new("/repos/m/.git");
        let path = path_for(&dir, git_dir);
        let refs = [label("main", "c", RefKind::Head)];
        let mapped = Mailmap::from_bytes(b"Ada Lovelace <ada@example.com>\n");
        store(
            &path,
            git_dir,
            &Fingerprint::of(&refs).with_mailmap(&mapped),
            &graph(),
        )
        .unwrap();

        assert!(
            load(
                &path,
                git_dir,
                &Fingerprint::of(&refs).with_mailmap(&mapped)
            )
            .is_some()
        );
        assert!(load(&path, git_dir, &Fingerprint::of(&refs)).is_none());
        let edited = Mailmap::from_bytes(b"Ada King <ada@example.com>\n");
        assert!(
            load(
                &path,
                git_dir,
                &Fingerprint::of(&refs).with_mailmap(&edited)
            )
            .is_none()
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_and_corrupt_files_are_ignored_and_corrupt_ones_removed() {
        let dir = scratch("corrupt");
        let git_dir = Path::new("/repos/b/.git");
        let path = path_for(&dir, git_dir);
        let print = Fingerprint::of(&[]);
        assert!(load(&path, git_dir, &print).is_none());

        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, b"definitely not a cache").unwrap();
        assert!(load(&path, git_dir, &print).is_none());
        assert!(!path.exists(), "an unreadable file is deleted");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_from_another_format_version_is_not_used() {
        let dir = scratch("version");
        let git_dir = Path::new("/repos/c/.git");
        let path = path_for(&dir, git_dir);
        let print = Fingerprint::of(&[]);
        let old = postcard::to_allocvec(&FileRef {
            version: FORMAT_VERSION + 1,
            git_dir: "/repos/c/.git",
            fingerprint: &print,
            graph: &graph(),
        })
        .unwrap();
        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, old).unwrap();

        assert!(load(&path, git_dir, &print).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn each_repository_gets_its_own_file_and_the_directory_stays_bounded() {
        let dir = scratch("prune");
        assert_ne!(
            path_for(&dir, Path::new("/repos/a/.git")),
            path_for(&dir, Path::new("/repos/b/.git"))
        );

        let print = Fingerprint::of(&[]);
        for n in 0..MAX_FILES + 5 {
            let git_dir = PathBuf::from(format!("/repos/{n}/.git"));
            let path = path_for(&dir, &git_dir);
            store(&path, &git_dir, &print, &graph()).unwrap();
        }
        let files = fs::read_dir(&dir).unwrap().count();
        assert_eq!(files, MAX_FILES);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sweep_removes_the_files_of_missing_repositories_and_leftovers() {
        let dir = scratch("sweep");
        let live = scratch("sweep-live-repo");
        fs::create_dir_all(&live).unwrap();
        let print = Fingerprint::of(&[]);
        let kept = path_for(&dir, &live);
        store(&kept, &live, &print, &graph()).unwrap();
        let gone_dir = Path::new("/nowhere/at/all/.git");
        let gone = path_for(&dir, gone_dir);
        store(&gone, gone_dir, &print, &graph()).unwrap();
        let unreadable = dir.join(format!("0000.{EXTENSION}"));
        fs::write(&unreadable, b"junk").unwrap();
        let leftover = dir.join("1234.tmp-1");
        fs::write(&leftover, b"half").unwrap();
        let other = dir.join("notes.txt");
        fs::write(&other, b"not ours").unwrap();

        assert_eq!(usage(&dir).files, 3);
        assert_eq!(sweep(&dir), 3);

        assert!(kept.exists() && other.exists());
        assert!(!gone.exists() && !unreadable.exists() && !leftover.exists());
        assert_eq!(usage(&dir).files, 1);
        assert!(load(&kept, &live, &print).is_some());
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&live);
    }

    #[test]
    fn clear_removes_every_graph_file_and_nothing_else() {
        let dir = scratch("clear");
        let print = Fingerprint::of(&[]);
        for n in 0..3 {
            let git_dir = PathBuf::from(format!("/repos/{n}/.git"));
            store(&path_for(&dir, &git_dir), &git_dir, &print, &graph()).unwrap();
        }
        fs::write(dir.join("notes.txt"), b"not ours").unwrap();
        let before = usage(&dir);
        assert_eq!(before.files, 3);
        assert!(before.bytes > 0);

        assert_eq!(clear(&dir).unwrap(), 3);
        assert_eq!(usage(&dir), CacheUsage::default());
        assert!(dir.join("notes.txt").exists());
        assert_eq!(clear(&scratch("clear-missing")).unwrap(), 0);
        let _ = fs::remove_dir_all(&dir);
    }
}
