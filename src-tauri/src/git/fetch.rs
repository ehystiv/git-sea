//! Keeps the remote branches up to date: `git fetch` when a repository opens, then every few
//! minutes. The only thing the app writes to a repository, and only what a fetch writes: remote
//! branches (`refs/remotes/…`), tags and objects. Local branches, the index and the files are never
//! touched. New remote refs reach the graph through the ref watcher, like any other change.
//!
//! It runs the system `git` rather than gix, so the user's own credentials work as they do in a
//! terminal (ssh-agent, the Keychain, credential helpers); it never asks for one.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use specta::Type;

/// Time between two fetches.
pub const INTERVAL: Duration = Duration::from_secs(180);
/// A fetch still running after this long is stopped (a network that hangs, a server that stalls).
const TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Default, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FetchState {
    /// False when the repository has no remotes: there is nothing to fetch.
    pub has_remotes: bool,
    pub running: bool,
    /// When the last fetch ended well, in milliseconds since the Unix epoch.
    pub last_success_ms: Option<f64>,
    /// Why the last fetch failed; cleared by the next one that works.
    pub last_error: Option<String>,
}

/// Fetches in the background for as long as it lives.
pub struct Fetcher {
    state: Arc<Mutex<FetchState>>,
    /// Wakes the thread for a fetch now; dropping it stops the thread.
    wake: Sender<()>,
}

impl Fetcher {
    /// Starts fetching `repo` now and then every `INTERVAL`. `on_change` runs (on the background
    /// thread) whenever the state changes: a fetch starts or ends.
    pub fn start(repo: &gix::Repository, on_change: impl Fn() + Send + 'static) -> Self {
        let state = Arc::new(Mutex::new(FetchState {
            has_remotes: !repo.remote_names().is_empty(),
            ..FetchState::default()
        }));
        let (wake, rx) = mpsc::channel::<()>();
        let dir = repo
            .workdir()
            .unwrap_or_else(|| repo.git_dir())
            .to_path_buf();
        let shared = Arc::clone(&state);
        thread::spawn(move || {
            loop {
                if lock(&shared).has_remotes {
                    run_once(&dir, &shared, &on_change);
                }
                match rx.recv_timeout(INTERVAL) {
                    Ok(()) | Err(RecvTimeoutError::Timeout) => {
                        // Several requests while one was running make a single fetch.
                        while rx.try_recv().is_ok() {}
                    }
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
        });
        Self { state, wake }
    }

    pub fn state(&self) -> FetchState {
        lock(&self.state).clone()
    }

    /// Fetches now instead of waiting for the next round.
    pub fn fetch_now(&self) {
        let _ = self.wake.send(());
    }
}

fn lock(state: &Mutex<FetchState>) -> std::sync::MutexGuard<'_, FetchState> {
    state.lock().unwrap_or_else(PoisonError::into_inner)
}

fn run_once(dir: &Path, state: &Mutex<FetchState>, on_change: &impl Fn()) {
    lock(state).running = true;
    on_change();
    let result = fetch(dir);
    {
        let mut state = lock(state);
        state.running = false;
        match result {
            Ok(()) => {
                state.last_error = None;
                state.last_success_ms = Some(now_ms());
            }
            Err(message) => {
                tracing::info!(%message, "fetch failed");
                state.last_error = Some(message);
            }
        }
    }
    on_change();
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |d| d.as_millis() as f64)
}

/// `git fetch --all` in `dir`. The error is what git said, or why it could not run.
pub fn fetch(dir: &Path) -> Result<(), String> {
    let git = find_git().ok_or_else(|| crate::i18n::tr("git not found", "git non trovato"))?;
    let mut child = crate::process::command(git)
        .arg("-C")
        .arg(dir)
        .args(["fetch", "--all", "--quiet", "--no-write-fetch-head"])
        // Never wait for a password nobody can type: fail instead.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("SSH_ASKPASS_REQUIRE", "never")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

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
        thread::sleep(Duration::from_millis(200));
    };
    if status.success() {
        return Ok(());
    }
    let mut stderr = String::new();
    if let Some(mut pipe) = child.stderr.take() {
        let _ = std::io::Read::read_to_string(&mut pipe, &mut stderr);
    }
    // git ends with the line that matters ("fatal: Could not read from remote repository.").
    let last = stderr.lines().rev().find(|l| !l.trim().is_empty());
    Err(last.map_or_else(
        || crate::i18n::tr("git fetch failed", "git fetch non riuscito"),
        |line| line.trim().to_owned(),
    ))
}

/// The `git` to run. On macOS `/usr/bin/git` is only a stub until the developer tools are
/// installed, and running it then opens an installation dialog: it is used only when they are.
fn find_git() -> Option<PathBuf> {
    crate::process::candidates("git").find(|git| {
        !(cfg!(target_os = "macos") && git == Path::new("/usr/bin/git") && !developer_tools())
    })
}

fn developer_tools() -> bool {
    Command::new("/usr/bin/xcode-select")
        .arg("-p")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}
