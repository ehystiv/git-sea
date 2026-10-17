//! On-disk cache of a repository's graph (commits and lane layout).
//!
//! Walking and laying out 50k commits takes a few hundred milliseconds; reading the result back
//! from a file is faster still. A cache file is only trusted when the refs it was built from are
//! exactly the refs the repository has now, so a new commit, branch, tag or deletion makes it
//! stale and the graph is built again.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::git::commits::{CommitSummary, RefKind, RefLabel};
use crate::graph::lanes::GraphRow;

/// Bump when the file layout or the lane algorithm changes: older files are then ignored.
const FORMAT_VERSION: u32 = 1;
/// Smaller histories load instantly, so they are not worth a file.
pub const MIN_CACHED_COMMITS: usize = 1_000;
/// Files kept in the cache directory; the least recently written go first.
const MAX_FILES: usize = 30;
const EXTENSION: &str = "graph";

/// What the graph was built from: every ref with the commit it pointed to, in a fixed order.
/// Compared whole rather than hashed, so a stale file can never pass for a fresh one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fingerprint(Vec<(u8, String, String)>);

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
        Self(entries)
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
    fingerprint: &'a Fingerprint,
    graph: &'a CachedGraph,
}

#[derive(Deserialize)]
struct File {
    version: u32,
    fingerprint: Fingerprint,
    graph: CachedGraph,
}

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

/// The cached graph, if the file exists, is readable, and was built from exactly `fingerprint`.
/// A file that cannot be decoded is deleted.
pub fn load(path: &Path, fingerprint: &Fingerprint) -> Option<CachedGraph> {
    let bytes = fs::read(path).ok()?;
    let file: File = match postcard::from_bytes(&bytes) {
        Ok(file) => file,
        Err(err) => {
            tracing::warn!(%err, path = %path.display(), "discarding unreadable graph cache");
            let _ = fs::remove_file(path);
            return None;
        }
    };
    (file.version == FORMAT_VERSION && file.fingerprint == *fingerprint).then_some(file.graph)
}

/// Writes the cache file (through a temporary file, so a crash never leaves a half-written one).
pub fn store(path: &Path, fingerprint: &Fingerprint, graph: &CachedGraph) -> io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(dir)?;
    let bytes = postcard::to_allocvec(&FileRef {
        version: FORMAT_VERSION,
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
        let path = path_for(&dir, Path::new("/repos/a/.git"));
        let print = Fingerprint::of(&[label("main", "c", RefKind::Head)]);

        store(&path, &print, &graph()).unwrap();

        assert_eq!(load(&path, &print), Some(graph()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn any_change_to_the_refs_makes_the_cache_stale() {
        let dir = scratch("stale");
        let path = path_for(&dir, Path::new("/repos/a/.git"));
        let refs = [
            label("main", "c", RefKind::Head),
            label("v1", "a", RefKind::Tag),
        ];
        store(&path, &Fingerprint::of(&refs), &graph()).unwrap();

        // The same refs in another order are the same repository state.
        let reordered = [refs[1].clone(), refs[0].clone()];
        assert!(load(&path, &Fingerprint::of(&reordered)).is_some());

        // A moved ref, a new ref and a deleted ref are all different.
        let moved = [label("main", "b", RefKind::Head), refs[1].clone()];
        assert!(load(&path, &Fingerprint::of(&moved)).is_none());
        let added = [
            refs[0].clone(),
            refs[1].clone(),
            label("x", "a", RefKind::Branch),
        ];
        assert!(load(&path, &Fingerprint::of(&added)).is_none());
        assert!(load(&path, &Fingerprint::of(&refs[..1])).is_none());
        // The same name as another kind is not the same ref either.
        let retyped = [label("main", "c", RefKind::Branch), refs[1].clone()];
        assert!(load(&path, &Fingerprint::of(&retyped)).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_and_corrupt_files_are_ignored_and_corrupt_ones_removed() {
        let dir = scratch("corrupt");
        let path = path_for(&dir, Path::new("/repos/b/.git"));
        let print = Fingerprint::of(&[]);
        assert!(load(&path, &print).is_none());

        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, b"definitely not a cache").unwrap();
        assert!(load(&path, &print).is_none());
        assert!(!path.exists(), "an unreadable file is deleted");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_from_another_format_version_is_not_used() {
        let dir = scratch("version");
        let path = path_for(&dir, Path::new("/repos/c/.git"));
        let print = Fingerprint::of(&[]);
        let old = postcard::to_allocvec(&FileRef {
            version: FORMAT_VERSION + 1,
            fingerprint: &print,
            graph: &graph(),
        })
        .unwrap();
        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, old).unwrap();

        assert!(load(&path, &print).is_none());
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
            let path = path_for(&dir, Path::new(&format!("/repos/{n}/.git")));
            store(&path, &print, &graph()).unwrap();
        }
        let files = fs::read_dir(&dir).unwrap().count();
        assert_eq!(files, MAX_FILES);
        let _ = fs::remove_dir_all(&dir);
    }
}
