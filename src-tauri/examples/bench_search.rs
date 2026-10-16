//! Times the backend searches (whole message, changed path) on a real repository.
//!
//!     cargo run --release --example bench_search -- <repo> <message text> <path>

use std::path::PathBuf;

use git_sea_lib::git::commits::{collect_refs, repo_for_walk};
use git_sea_lib::git::search::{SearchField, search_commits};

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = PathBuf::from(
        args.next()
            .expect("usage: bench_search <repo> <text> <path>"),
    );
    let text = args.next().unwrap_or_else(|| "fix".to_owned());
    let path = args.next().unwrap_or_else(|| "README.md".to_owned());

    let handle = gix::open(&dir).expect("open").into_sync();
    for (field, query) in [(SearchField::Message, &text), (SearchField::Path, &path)] {
        // A fresh handle each time, as each search command gets one.
        let repo = repo_for_walk(&handle);
        let tips = collect_refs(&repo).expect("refs").tips;
        let result = search_commits(&repo, tips, field, query, &|| false).expect("search");
        println!(
            "{field:?} {query:?}: {} matches in {} ms{}",
            result.ids.len(),
            result.elapsed_ms,
            if result.truncated { " (truncated)" } else { "" }
        );
    }
}
