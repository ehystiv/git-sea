//! Times the commit walk on a real repository.
//!
//!     cargo run --release --example bench_walk -- <repo> [rev|-] [dump.json]
//!
//! With `rev` (e.g. `main~59000`) only the history reachable from it is walked, which lets one big
//! repository stand in for smaller ones (`-` means all refs). With a third argument the commits,
//! graph rows and ref labels are written there, for the profiling page of the frontend.

use std::path::PathBuf;
use std::time::Instant;

use git_sea_lib::cache::{self, CachedGraph, Fingerprint};
use git_sea_lib::git::commits::{collect_refs, repo_for_walk, stream_cached, stream_commits};
use git_sea_lib::graph::lanes::validate_rows;

fn main() {
    let mut args = std::env::args().skip(1);
    let path = PathBuf::from(args.next().expect("usage: bench_walk <repo> [rev]"));
    let rev = args.next().filter(|r| r != "-");
    let dump = args.next();

    let repo = repo_for_walk(&gix::ThreadSafeRepository::open(&path).expect("open repo"));
    let snapshot = collect_refs(&repo).expect("refs");
    let tips = match &rev {
        Some(spec) => vec![repo.rev_parse_single(spec.as_str()).expect("rev").detach()],
        None => snapshot.tips.clone(),
    };
    let has_graph = repo.commit_graph_if_enabled().ok().flatten().is_some();

    let wall = Instant::now();
    let mut chunks = 0;
    let mut all_rows = Vec::new();
    let mut all_commits = Vec::new();
    let stats = stream_commits(&repo, tips, &|| false, &mut |commits, rows| {
        chunks += 1;
        all_rows.extend(rows);
        all_commits.extend(commits);
        true
    })
    .expect("walk");

    println!(
        "commits={} lanes={} chunks={} commit_graph={} setup={}ms first_chunk={}ms total={}ms wall={}ms",
        stats.total,
        stats.max_lanes,
        chunks,
        has_graph,
        stats.setup_ms,
        stats.first_chunk_ms,
        stats.total_ms,
        wall.elapsed().as_millis()
    );

    println!("layout check: {:?}", validate_rows(&all_rows));

    // The same history through the on-disk cache: write it, then read it back and stream it.
    let graph = CachedGraph {
        commits: all_commits.clone(),
        rows: all_rows.clone(),
        max_lanes: stats.max_lanes,
    };
    let print = Fingerprint::of(&snapshot.labels);
    let file = std::env::temp_dir().join(format!("bench-walk-{}.graph", std::process::id()));
    let written = Instant::now();
    cache::store(&file, &print, &graph).expect("store");
    let write_ms = written.elapsed().as_millis();
    let size_mb = std::fs::metadata(&file)
        .map(|m| m.len() as f64 / 1_048_576.0)
        .unwrap_or(0.0);

    let reopened = Instant::now();
    let loaded = cache::load(&file, &print).expect("fresh cache");
    let load_ms = reopened.elapsed().as_millis();
    let cached = stream_cached(&loaded, &|| false, &mut |_, _| true);
    println!(
        "cache: file={size_mb:.1}MB write={write_ms}ms load={load_ms}ms first_chunk_after_load={}ms \
         reopen_total={}ms",
        cached.first_chunk_ms,
        reopened.elapsed().as_millis()
    );
    let _ = std::fs::remove_file(&file);

    if let Some(path) = dump {
        let json = serde_json::json!({
            "commits": all_commits,
            "rows": all_rows,
            "refs": snapshot.labels,
        });
        std::fs::write(&path, serde_json::to_vec(&json).expect("json")).expect("write dump");
        println!("dumped {} commits to {path}", all_commits.len());
    }
}
