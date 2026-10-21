# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

git-sea is a Git history viewer for macOS, Linux and Windows built with Tauri 2: a Rust backend (`src-tauri/`, using `gix`) and a React 19 + TypeScript + Vite frontend (`src/`). It never writes to repositories, with one exception: a background `git fetch --all` (`src-tauri/src/git/fetch.rs`) that updates remote refs.

`PROPOSTE.md` (in Italian) lists the proposed features and improvements, and which ones are done.

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

**Per-tab sessions.** `open_repo` creates a `RepoSession` (`src-tauri/src/session.rs`) and returns its id. The session holds the `gix` handle, the `.git` and working-copy watchers and the background fetcher, and every later command takes that id. Loads and searches use generation counters: starting a new load or search cancels the one already running on that session. The backend tells the frontend about changes through events (`repo-changed`, `worktree-changed`, `fetch-changed`, and `menu` from the native menu), with the session id as payload. Repositories asked for from a terminal or the system (`git-sea <path>`, a second launch through `tauri-plugin-single-instance`, macOS open events) wait in `launch.rs` until the frontend takes them with `take_launch_paths`; `open-paths` says there are some.

**Graph layout lives in Rust.** `git/commits.rs` walks the commits in topological order (`gix::traverse::commit::topo`) and `graph/lanes.rs` assigns lanes incrementally. The commits stream to the frontend in chunks through a `tauri::ipc::Channel` (a small first chunk, then `CHUNK_SIZE` chunks). `cache/` stores the finished layout on disk (postcard), keyed by a fingerprint of all refs.

**Frontend views are projections of `GraphIndex`.** `useCommitStream` collects the streamed rows into a mutable `GraphIndex` (`src/features/graph/GraphIndex.ts`) and bumps a `version` number on each change. The views read from this index:
- graph canvas (`features/graph/`): x = topological column, y = lane
- compressed topology (`compress.ts`): folds linear runs into single nodes
- timeline (`features/timeline/layout.ts`)
- minimap
- statistics (`features/stats/`): DOM and SVG, not canvas; pure counts in `stats.ts`

The canvas views are drawn on Canvas 2D by imperative controller classes (`GraphController`, `TimelineController`) that live outside React's render cycle. React components only mount them and pass callbacks. Drawing is in `draw.ts`. View math (pan, zoom, fit, clamp), hit testing, morph and arrival animations, and "unseen commits" are separate pure modules with their own `.test.ts`, so new logic should be kept testable the same way. The graph has levels of detail (card, tile, dot) and only draws the visible columns. `features/sea/` is a decorative fish layer behind the graph, with pure simulation in `sea.ts`, drawing in `SeaLayer.ts` and on/off state in `src/lib/sea.ts`.

**State.** Zustand stores (tabs, palette, sea) plus TanStack Query for command data (details, diffs, stashes, worktree). Styling uses plain CSS tokens in `src/styles/tokens.css` and CSS Modules. Canvas colors are read from the CSS tokens (`palette.ts`) and re-read on `THEME_CHANGED`.

## Dev-only pages

These pages are not part of the app build. Their data goes in `public/dev-data/`, which git ignores.

- `app.html`: the whole app in a plain browser with a fake backend that serves a graph dump (`?data=<name>`).
- `bench.html`: graph rendering profiler. Generate its data with `cargo run --release --example bench_walk -- <repo> <rev|-> public/dev-data/<file>.json`.
- `panel.html`: the details panel with real backend data (`cargo run --example dump_commit -- <repo> "<summary>" public/dev-data/commit.json`).
- `shell.html`: the tabs and sidebar with real data.

Outside Tauri, `getCurrentWebview()` throws synchronously, so calls to it are wrapped in try/catch.

## Platforms

macOS is the main target; Linux and Windows are built and released too. Platform differences live in a few places: `src-tauri/tauri.linux.conf.json` and `tauri.windows.conf.json` (opaque window with system decorations instead of the transparent overlay title bar), `#[cfg(target_os = ...)]` in `lib.rs` (vibrancy, native menu) and `ci/auth.rs` (Keychain on macOS, Secret Service on Linux, Credential Manager on Windows), `src-tauri/src/process.rs` (finding and running `git`/`gh`/`glab` and the browser; always go through it so programs get `.exe` and no console window on Windows), and `src/lib/platform.ts` on the frontend (`hasModKey`/`modShortcut` for ⌘ vs Ctrl, `data-platform` on `<html>` for the CSS). Use those helpers for new shortcuts instead of checking `metaKey`. `.github/workflows/ci.yml` runs lint and tests on all three platforms. `act` (see `.actrc`) can run the Ubuntu jobs locally; it cannot run the macOS or Windows ones.

## Languages

The UI is in English and Italian. Every user-visible text goes through `src/lib/i18n/`: `en.ts` is the reference (its type is `Messages`) and `it.ts` must have the same keys, which `tsc` and `messages.test.ts` check. Components read texts with `useT()` (named `m` by convention, since `t` is often a loop variable); code outside React, like canvas tooltips and pure helpers, uses `t()` or takes `m: Messages = t()` as its last parameter so tests can pass a language. Dates and numbers go through the helpers in `lib/format.ts` (`formatDateTime`, `formatAgo`, `formatCount`, `dateFormatter`), which follow the UI locale. The choice ("system", "en", "it") is persisted; "system" uses the locale the backend reads with `sys-locale`. The backend's own texts (native menu, CI and fetch messages) use `i18n::tr(en, it)` in `src-tauri/src/i18n.rs`; the frontend keeps it in step with the `set_language` command, which also rebuilds the menu.

## Conventions

- Rust: errors are typed with `thiserror` (`AppError` in `error.rs`), and there is no `unwrap()` outside tests.
- TypeScript: `strict` is on and `any` is not allowed.
- Unit tests cover all of `graph/`, and Rust fixtures come from the scripts in `tests/fixtures/`.
- Commits follow Conventional Commits.
- Code and comments are in English, and communication with the user is in Italian.
- New dependencies can be added without asking, but each one must be mentioned with the reason for it.

## Technical notes

- Authors go through `.mailmap` (`git/mailmap.rs`) wherever the backend reads them; the mailmap is part of the cache fingerprint.
- `gix` needs the `sha1` feature (with `max-performance-safe`). Its open errors are opaque, so "not a repository" is detected first by checking for `.git` (or `HEAD` + `objects/` for bare repos).
- Topological order comes from `gix::traverse::commit::topo::Builder`, not `gix::revision::walk::Sorting`. `build()` first visits everything to count in-degrees; the 64 MB object cache keeps it fast.
- `data-tauri-drag-region` applies only to the element itself, so non-interactive children of the title bar have `pointer-events: none`. Window dragging needs the `core:window:allow-start-dragging` and `allow-internal-toggle-maximize` permissions.
