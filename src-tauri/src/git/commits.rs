use std::time::Instant;

use gix::traverse::commit::topo::{Builder, Sorting};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::cache::CachedGraph;
use crate::error::AppError;
use crate::graph::lanes::{GraphRow, LaneLayout};

/// The first chunk is small so the UI can paint rows right away.
pub const FIRST_CHUNK_SIZE: usize = 256;
pub const CHUNK_SIZE: usize = 2_000;

/// Commits are read twice (topological pre-walk, then message and author); a decoded-object cache
/// makes the second read free. On a 49k-commit repo this cut the first chunk from ~790 ms to ~250 ms.
const OBJECT_CACHE_BYTES: usize = 64 * 1024 * 1024;

/// A thread-local repository handle configured for walking the whole history.
pub fn repo_for_walk(handle: &gix::ThreadSafeRepository) -> gix::Repository {
    let mut repo = handle.to_thread_local();
    repo.object_cache_size_if_unset(OBJECT_CACHE_BYTES);
    repo
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    /// Full hex object id.
    pub id: String,
    /// First line of the commit message.
    pub summary: String,
    pub author: String,
    /// Author time, seconds since the Unix epoch.
    #[specta(type = f64)]
    pub time: i64,
    /// Full hex ids of the parents, first parent first.
    pub parents: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum LoadEvent {
    /// Sent once, before the first chunk.
    Refs { refs: Vec<RefLabel> },
    Chunk {
        commits: Vec<CommitSummary>,
        /// Graph placement of each commit of the chunk, in the same order.
        rows: Vec<GraphRow>,
    },
    #[serde(rename_all = "camelCase")]
    Done {
        total: u32,
        /// Time spent preparing the topological walk before the first commit.
        setup_ms: u32,
        /// Time from the start of the load to the first chunk sent.
        first_chunk_ms: u32,
        /// Time from the start of the load to the last chunk sent.
        total_ms: u32,
        /// Most lanes open at the same time anywhere in the graph.
        max_lanes: u32,
        /// The graph came from the on-disk cache instead of a walk of the repository.
        from_cache: bool,
    },
}

#[derive(Debug, Clone, Copy)]
pub struct WalkStats {
    pub total: u32,
    pub setup_ms: u32,
    pub first_chunk_ms: u32,
    pub total_ms: u32,
    pub max_lanes: u32,
    pub from_cache: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Type)]
pub enum RefKind {
    /// The branch HEAD points to, or a detached HEAD.
    Head,
    Branch,
    Remote,
    Tag,
}

/// A name shown on a commit: branch, remote branch, tag or HEAD.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RefLabel {
    /// Full hex id of the commit the ref points to (tags are peeled).
    pub commit: String,
    pub name: String,
    pub kind: RefKind,
}

pub struct RefSnapshot {
    /// Tips of every commit reachable from HEAD, local branches, remote branches and tags
    /// (like `git log --all`, minus the stash and notes refs).
    pub tips: Vec<gix::ObjectId>,
    pub labels: Vec<RefLabel>,
}

pub fn collect_refs(repo: &gix::Repository) -> Result<RefSnapshot, AppError> {
    let git = |e: &dyn std::fmt::Display| AppError::Git(e.to_string());
    let mut tips = Vec::new();
    let mut labels = Vec::new();

    let head = repo.head().map_err(|e| git(&e))?;
    let head_name: Option<gix::bstr::BString> =
        head.referent_name().map(|name| name.as_bstr().to_owned());
    let head_id = head.id().map(|id| id.detach());
    if let Some(id) = head_id {
        tips.push(id);
        if head_name.is_none() {
            labels.push(RefLabel {
                commit: id.to_string(),
                name: "HEAD".to_owned(),
                kind: RefKind::Head,
            });
        }
    }

    // Symbolic refs such as `refs/remotes/origin/HEAD` are followed when the iterator peels them,
    // so they come out under the name of their target; each name is listed only once.
    let mut seen = std::collections::HashSet::new();
    let refs = repo.references().map_err(|e| git(&e))?;
    let iter = refs
        .all()
        .map_err(|e| git(&e))?
        .peeled()
        .map_err(|e| git(&e))?;
    for reference in iter {
        let Ok(reference) = reference else { continue };
        let full = reference.name().as_bstr();
        let kind = if full.starts_with(b"refs/heads/") {
            RefKind::Branch
        } else if full.starts_with(b"refs/remotes/") && !full.ends_with(b"/HEAD") {
            RefKind::Remote
        } else if full.starts_with(b"refs/tags/") {
            RefKind::Tag
        } else {
            continue;
        };
        let Some(id) = reference.try_id() else {
            continue;
        };
        let id = id.detach();
        // Tags can point at trees or blobs; only commits are part of the graph.
        match repo.find_header(id) {
            Ok(header) if header.kind() == gix::object::Kind::Commit => {}
            _ => continue,
        }

        let full_bytes: &[u8] = full.as_ref();
        let is_head = head_name
            .as_ref()
            .is_some_and(|name| name.as_slice() == full_bytes);
        let kind = if kind == RefKind::Branch && is_head {
            RefKind::Head
        } else {
            kind
        };
        let name = reference.name().shorten().to_string();
        if !seen.insert((kind, name.clone())) {
            continue;
        }
        tips.push(id);
        labels.push(RefLabel {
            commit: id.to_string(),
            name,
            kind,
        });
    }

    tips.sort();
    tips.dedup();
    Ok(RefSnapshot { tips, labels })
}

/// Walks the commits reachable from `tips` in topological order (children before parents) and
/// hands them to `send` in chunks. `send` returns `false` to stop (e.g. the frontend went away);
/// `cancelled` is polled between commits.
pub fn stream_commits(
    repo: &gix::Repository,
    tips: Vec<gix::ObjectId>,
    cancelled: &dyn Fn() -> bool,
    send: &mut dyn FnMut(Vec<CommitSummary>, Vec<GraphRow>) -> bool,
) -> Result<WalkStats, AppError> {
    let git = |e: &dyn std::fmt::Display| AppError::Git(e.to_string());
    let start = Instant::now();

    let graph = repo.commit_graph_if_enabled().ok().flatten();
    let walk = Builder::from_iters(&repo.objects, tips, None::<Vec<gix::ObjectId>>)
        .sorting(Sorting::TopoOrder)
        .with_commit_graph(graph)
        .build()
        .map_err(|e| git(&e))?;
    let setup_ms = millis(start);

    let mut layout = LaneLayout::new();
    let mut chunk = Vec::with_capacity(FIRST_CHUNK_SIZE);
    let mut rows = Vec::with_capacity(FIRST_CHUNK_SIZE);
    let mut limit = FIRST_CHUNK_SIZE;
    let mut total = 0u32;
    let mut first_chunk_ms = None;

    for info in walk {
        if cancelled() {
            break;
        }
        let info = info.map_err(|e| git(&e))?;
        chunk.push(summarize(repo, &info)?);
        rows.push(layout.push(info.id, &info.parent_ids));
        total += 1;

        if chunk.len() >= limit {
            first_chunk_ms.get_or_insert_with(|| millis(start));
            if !send(std::mem::take(&mut chunk), std::mem::take(&mut rows)) {
                break;
            }
            chunk.reserve(CHUNK_SIZE);
            rows.reserve(CHUNK_SIZE);
            limit = CHUNK_SIZE;
        }
    }
    if !chunk.is_empty() && !cancelled() {
        first_chunk_ms.get_or_insert_with(|| millis(start));
        send(chunk, rows);
    }

    let total_ms = millis(start);
    Ok(WalkStats {
        total,
        setup_ms,
        first_chunk_ms: first_chunk_ms.unwrap_or(total_ms),
        total_ms,
        max_lanes: u32::try_from(layout.max_width()).unwrap_or(u32::MAX),
        from_cache: false,
    })
}

/// Sends a cached graph in the same chunks a walk would have produced.
pub fn stream_cached(
    graph: &CachedGraph,
    cancelled: &dyn Fn() -> bool,
    send: &mut dyn FnMut(Vec<CommitSummary>, Vec<GraphRow>) -> bool,
) -> WalkStats {
    let start = Instant::now();
    let mut first_chunk_ms = None;
    let mut sent = 0usize;
    let mut limit = FIRST_CHUNK_SIZE;

    while sent < graph.commits.len() && !cancelled() {
        let end = (sent + limit).min(graph.commits.len());
        let delivered = send(
            graph.commits[sent..end].to_vec(),
            graph.rows[sent..end].to_vec(),
        );
        first_chunk_ms.get_or_insert_with(|| millis(start));
        sent = end;
        limit = CHUNK_SIZE;
        if !delivered {
            break;
        }
    }

    let total_ms = millis(start);
    WalkStats {
        total: count_u32(sent),
        setup_ms: 0,
        first_chunk_ms: first_chunk_ms.unwrap_or(total_ms),
        total_ms,
        max_lanes: graph.max_lanes,
        from_cache: true,
    }
}

fn count_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

fn summarize(
    repo: &gix::Repository,
    info: &gix::traverse::commit::Info,
) -> Result<CommitSummary, AppError> {
    let git = |e: &dyn std::fmt::Display| AppError::Git(e.to_string());
    let commit = repo.find_commit(info.id).map_err(|e| git(&e))?;
    let message = commit.message().map_err(|e| git(&e))?;
    let author = commit.author().map_err(|e| git(&e))?;

    Ok(CommitSummary {
        id: info.id.to_string(),
        summary: message.summary().to_string(),
        author: author.name.to_string(),
        time: author.seconds(),
        parents: info.parent_ids.iter().map(ToString::to_string).collect(),
    })
}

fn millis(start: Instant) -> u32 {
    u32::try_from(start.elapsed().as_millis()).unwrap_or(u32::MAX)
}
