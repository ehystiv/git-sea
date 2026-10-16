# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

git-sea is a macOS Git history viewer built with Tauri 2: a Rust backend (`src-tauri/`, using `gix`) and a React 19 + TypeScript + Vite frontend (`src/`). It never writes to repositories, with one exception: a background `git fetch --all` (`src-tauri/src/git/fetch.rs`) that updates remote refs.

`PLAN.md` (in Italian) is the full project plan: requirements, phases, conventions and technical notes. Read its sections 6 and 7 before you make non-trivial changes.

## Commands

```sh
pnpm install
pnpm tauri dev            # run the app (Vite on fixed port 1420)
pnpm tauri build          # release build
pnpm build                # frontend typecheck (tsc) + vite build

pnpm test                                  # all frontend tests (Vitest, src/**/*.test.ts)
pnpm vitest run src/features/graph/flow.test.ts   # one test file
pnpm vitest run -t "test name"             # tests whose name matches

cd src-tauri
cargo test                     # all Rust tests (unit + integration in tests/)
cargo test --test commits      # one integration test file
cargo test export_bindings     # regenerate src/lib/bindings.ts without launching the app
cargo fmt && cargo clippy -- -D warnings   # must both be clean
```

The Rust integration tests build fixture repositories by running the shell scripts in `src-tauri/tests/fixtures/` in temporary directories.

## Architecture

**Typed IPC via tauri-specta.** Every command is registered in `specta_builder()` in `src-tauri/src/lib.rs` and implemented in `src-tauri/src/commands/mod.rs`. `src/lib/bindings.ts` is generated: debug builds and `cargo test export_bindings` rewrite it. Don't edit it by hand. Command types on the frontend come only from this file. Specta rejects `i64`/`u64`, so timestamps use `#[specta(type = f64)]`.

**Per-tab sessions.** `open_repo` creates a `RepoSession` (`src-tauri/src/session.rs`) and returns its id. The session holds the `gix` handle, the `.git` and working-copy watchers and the background fetcher, and every later command takes that id. Loads and searches use generation counters: starting a new load or search cancels the one already running on that session. The backend tells the frontend about changes through events (`repo-changed`, `worktree-changed`, `fetch-changed`, and `menu` from the native menu), with the session id as payload.

**Graph layout lives in Rust.** `git/commits.rs` walks the commits in topological order (`gix::traverse::commit::topo`) and `graph/lanes.rs` assigns lanes incrementally. The commits stream to the frontend in chunks through a `tauri::ipc::Channel` (a small first chunk, then `CHUNK_SIZE` chunks). `cache/` stores the finished layout on disk (postcard), keyed by a fingerprint of all refs.

**Frontend views are projections of `GraphIndex`.** `useCommitStream` collects the streamed rows into a mutable `GraphIndex` (`src/features/graph/GraphIndex.ts`) and bumps a `version` number on each change. The views read from this index:
- graph canvas (`features/graph/`): x = topological column, y = lane
- compressed topology (`compress.ts`): folds linear runs into single nodes
- timeline (`features/timeline/layout.ts`)
- minimap

The canvas views are drawn on Canvas 2D by imperative controller classes (`GraphController`, `TimelineController`) that live outside React's render cycle. React components only mount them and pass callbacks. Drawing is in `draw.ts`. View math (pan, zoom, fit, clamp), hit testing, morph and arrival animations, and "unseen commits" are separate pure modules with their own `.test.ts`, so new logic should be kept testable the same way. The graph has levels of detail (card, tile, dot) and only draws the visible columns. `features/sea/` is a decorative fish layer behind the graph, with pure simulation in `sea.ts`, drawing in `SeaLayer.ts` and on/off state in `src/lib/sea.ts`.

**State.** Zustand stores (tabs, palette, sea) plus TanStack Query for command data (details, diffs, stashes, worktree). Styling uses plain CSS tokens in `src/styles/tokens.css` and CSS Modules. Canvas colors are read from the CSS tokens (`palette.ts`) and re-read on `THEME_CHANGED`.

## Dev-only pages

These pages are not part of the app build. Their data goes in `public/dev-data/`, which git ignores.

- `app.html`: the whole app in a plain browser with a fake backend that serves a graph dump (`?data=<name>`).
- `bench.html`: graph rendering profiler. Generate its data with `cargo run --release --example bench_walk -- <repo> <rev|-> public/dev-data/<file>.json`.
- `panel.html`: the details panel with real backend data (`cargo run --example dump_commit -- <repo> "<summary>" public/dev-data/commit.json`).
- `shell.html`: the tabs and sidebar with real data.

Outside Tauri, `getCurrentWebview()` throws synchronously, so calls to it are wrapped in try/catch.

## Conventions (from PLAN.md)

- Rust: errors are typed with `thiserror` (`AppError` in `error.rs`), and there is no `unwrap()` outside tests.
- TypeScript: `strict` is on and `any` is not allowed.
- Unit tests cover all of `graph/`, and Rust fixtures come from the scripts in `tests/fixtures/`.
- Commits follow Conventional Commits.
- Code and comments are in English, and communication with the user is in Italian.
- New dependencies can be added without asking, but each one must be mentioned with the reason for it.
