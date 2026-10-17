//! The upstream of each local branch: the remote-tracking branch it merges from, as git works it
//! out from `branch.<name>.remote`, `branch.<name>.merge` and the remote's fetch refspecs.

use serde::Serialize;
use specta::Type;

use crate::error::AppError;
use crate::git::diff::git;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Upstream {
    /// Short name of the local branch, as in the ref labels (`main`).
    pub branch: String,
    /// Short name of its remote-tracking branch (`origin/main`). It may not exist locally yet,
    /// for instance before the first fetch.
    pub upstream: String,
}

/// Every local branch that has an upstream, ordered by branch name.
pub fn list_upstreams(repo: &gix::Repository) -> Result<Vec<Upstream>, AppError> {
    let refs = repo.references().map_err(git)?;
    let mut out = Vec::new();
    for reference in refs.local_branches().map_err(git)? {
        let Ok(reference) = reference else { continue };
        let name = reference.name();
        // A broken configuration only leaves that branch without an upstream.
        let Some(Ok(tracking)) =
            repo.branch_remote_tracking_ref_name(name, gix::remote::Direction::Fetch)
        else {
            continue;
        };
        out.push(Upstream {
            branch: name.shorten().to_string(),
            upstream: tracking.as_ref().shorten().to_string(),
        });
    }
    out.sort_by(|a, b| a.branch.cmp(&b.branch));
    Ok(out)
}
