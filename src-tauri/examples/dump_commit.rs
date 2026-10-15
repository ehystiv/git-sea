//! Writes what the details panel gets for one commit, as JSON, for the frontend dev page.
//!
//!     cargo run --example dump_commit -- <repo> <commit summary> <out.json>

use std::path::PathBuf;

use git_sea_lib::git::commits::{collect_refs, repo_for_walk, stream_commits};
use git_sea_lib::git::diff::{commit_details, file_diff};

fn main() {
    let mut args = std::env::args().skip(1);
    let path = PathBuf::from(
        args.next()
            .expect("usage: dump_commit <repo> <summary> <out.json>"),
    );
    let summary = args.next().expect("summary");
    let out = args.next().expect("out");

    let repo = repo_for_walk(&gix::ThreadSafeRepository::open(&path).expect("open"));
    let tips = collect_refs(&repo).expect("refs").tips;
    let mut commits = Vec::new();
    stream_commits(&repo, tips, &|| false, &mut |c, _| {
        commits.extend(c);
        true
    })
    .expect("walk");
    let commit = commits
        .iter()
        .find(|c| c.summary == summary)
        .expect("no such commit");

    let details = commit_details(&repo, &commit.id).expect("details");
    let diffs: serde_json::Map<String, serde_json::Value> = details
        .files
        .iter()
        .filter(|f| !f.binary)
        .map(|f| {
            let diff = file_diff(&repo, &commit.id, &f.path, f.old_path.as_deref()).expect("diff");
            (f.path.clone(), serde_json::to_value(diff).expect("json"))
        })
        .collect();

    let json = serde_json::json!({ "commit": commit, "details": details, "diffs": diffs });
    std::fs::write(&out, serde_json::to_vec_pretty(&json).expect("json")).expect("write");
    println!("wrote {} files to {out}", details.files.len());
}
