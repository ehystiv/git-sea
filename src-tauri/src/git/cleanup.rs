//! Refs worth cleaning up, for a sidebar section that only shows them (the app never deletes):
//! remote branches gone from their remote (`git remote prune` would remove them), local branches
//! whose upstream is gone, local branches with no upstream, and local branches already merged into
//! HEAD (`git branch --merged`).
//!
//! Which remote branches are gone needs the remote: `git ls-remote --heads`, with the user's own
//! credentials as for the fetch, never asking for one.

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use specta::Type;

use crate::error::AppError;
use crate::git::diff::git;
use crate::git::upstream;

/// `git ls-remote` still running after this long is stopped.
const TIMEOUT: Duration = Duration::from_secs(60);

/// A branch and the commit it points to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct CleanupRef {
    /// Short name: `origin/old-feature` for a remote branch, `old-feature` for a local one.
    pub name: String,
    pub commit: String,
}

#[derive(Debug, Clone, Default, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    /// Remote branches whose branch on the remote no longer exists, by remote then name.
    pub gone_remote: Vec<CleanupRef>,
    /// Local branches whose configured upstream no longer exists (here, or on the remote).
    pub gone_upstream: Vec<CleanupRef>,
    /// Local branches with no upstream configured.
    pub no_upstream: Vec<CleanupRef>,
    /// Local branches, other than HEAD's, whose tip HEAD already holds.
    pub merged: Vec<CleanupRef>,
    /// Remotes that could not be asked, with what git said.
    pub errors: Vec<String>,
}

/// What can be cleaned up in `repo`. `ls_remote` gives the branch names a remote has (by remote
/// name), or an error; it is a parameter so tests can do without a network.
pub fn cleanup_report(
    repo: &gix::Repository,
    ls_remote: &dyn Fn(&str) -> Result<HashSet<String>, String>,
) -> Result<CleanupReport, AppError> {
    let mut report = CleanupReport::default();
    let refs = repo.references().map_err(git)?;

    // Remote-tracking branches, by remote.
    let mut tracking: HashMap<String, Vec<CleanupRef>> = HashMap::new();
    for reference in refs.remote_branches().map_err(git)? {
        let Ok(mut reference) = reference else {
            continue;
        };
        let short = reference.name().shorten().to_string();
        let Some((remote, branch)) = short.split_once('/') else {
            continue;
        };
        if branch == "HEAD" {
            continue;
        }
        let Ok(id) = reference.peel_to_id() else {
            continue;
        };
        tracking
            .entry(remote.to_owned())
            .or_default()
            .push(CleanupRef {
                name: short.clone(),
                commit: id.to_string(),
            });
    }
    let mut remotes: Vec<&String> = tracking.keys().collect();
    remotes.sort();
    for remote in remotes {
        match ls_remote(remote) {
            Ok(heads) => {
                let mut gone: Vec<CleanupRef> = tracking[remote]
                    .iter()
                    .filter(|r| {
                        let branch = &r.name[remote.len() + 1..];
                        !heads.contains(branch)
                    })
                    .cloned()
                    .collect();
                gone.sort_by(|a, b| a.name.cmp(&b.name));
                report.gone_remote.extend(gone);
            }
            Err(err) => report.errors.push(format!("{remote}: {err}")),
        }
    }
    let gone_names: HashSet<&str> = report.gone_remote.iter().map(|r| r.name.as_str()).collect();
    let existing: HashSet<String> = tracking
        .values()
        .flatten()
        .map(|r| r.name.clone())
        .collect();

    let upstreams: HashMap<String, String> = upstream::list_upstreams(repo)?
        .into_iter()
        .map(|u| (u.branch, u.upstream))
        .collect();
    let head = repo.head().map_err(git)?;
    let head_name = head.referent_name().map(|n| n.shorten().to_string());
    let head_id = head.id().map(|id| id.detach());

    for reference in refs.local_branches().map_err(git)? {
        let Ok(mut reference) = reference else {
            continue;
        };
        let name = reference.name().shorten().to_string();
        let Ok(id) = reference.peel_to_id() else {
            continue;
        };
        let id = id.detach();
        let entry = CleanupRef {
            name: name.clone(),
            commit: id.to_string(),
        };
        match upstreams.get(&name) {
            Some(up) if !existing.contains(up) || gone_names.contains(up.as_str()) => {
                report.gone_upstream.push(entry.clone());
            }
            Some(_) => {}
            None => report.no_upstream.push(entry.clone()),
        }
        if Some(&name) != head_name.as_ref()
            && let Some(head_id) = head_id
            && (id == head_id
                || repo
                    .merge_base(id, head_id)
                    .ok()
                    .flatten()
                    .map(|b| b.detach())
                    == Some(id))
        {
            report.merged.push(entry);
        }
    }
    for list in [
        &mut report.gone_upstream,
        &mut report.no_upstream,
        &mut report.merged,
    ] {
        list.sort_by(|a, b| a.name.cmp(&b.name));
    }
    Ok(report)
}

/// The branch names `remote` has, from `git ls-remote --heads` run in `dir`.
pub fn ls_remote_heads(dir: &Path, remote: &str) -> Result<HashSet<String>, String> {
    let git = crate::git::fetch::find_git()
        .ok_or_else(|| crate::i18n::tr("git not found", "git non trovato"))?;
    let mut child = crate::process::command(git)
        .arg("-C")
        .arg(dir)
        .args(["ls-remote", "--heads", "--quiet", remote])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("SSH_ASKPASS_REQUIRE", "never")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    // Read while it runs: a big remote fills the pipe before git exits.
    let mut stdout = child.stdout.take().ok_or("no output")?;
    let reader = thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.read_to_string(&mut out);
        out
    });
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if started.elapsed() > TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(crate::i18n::tr("timed out", "tempo scaduto"));
        }
        thread::sleep(Duration::from_millis(100));
    };
    let out = reader.join().unwrap_or_default();
    if !status.success() {
        let mut stderr = String::new();
        if let Some(mut pipe) = child.stderr.take() {
            let _ = pipe.read_to_string(&mut stderr);
        }
        let last = stderr.lines().rev().find(|l| !l.trim().is_empty());
        return Err(last.map_or_else(
            || crate::i18n::tr("git ls-remote failed", "git ls-remote non riuscito"),
            |line| line.trim().to_owned(),
        ));
    }
    Ok(parse_heads(&out))
}

/// Branch names from `git ls-remote --heads` lines (`<id>\trefs/heads/<name>`).
fn parse_heads(out: &str) -> HashSet<String> {
    out.lines()
        .filter_map(|line| line.split_once('\t'))
        .filter_map(|(_, name)| name.trim().strip_prefix("refs/heads/"))
        .map(str::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_branch_names_of_ls_remote() {
        let out = "1111\trefs/heads/main\n2222\trefs/heads/feature/x\n3333\trefs/tags/v1\n";
        let heads = parse_heads(out);
        assert_eq!(heads.len(), 2);
        assert!(heads.contains("main") && heads.contains("feature/x"));
    }
}
