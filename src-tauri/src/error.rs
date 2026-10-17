use serde::Serialize;
use specta::Type;

/// Error returned by every Tauri command. The frontend switches on `kind`
/// to pick a user-facing message; `message` is for logs and debugging.
#[derive(Debug, thiserror::Error, Serialize, Type)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    #[error("path does not exist: {0}")]
    PathNotFound(String),
    #[error("not a git repository: {0}")]
    NotARepository(String),
    #[error("no open repository with session id {0}")]
    SessionNotFound(String),
    #[error("git error: {0}")]
    Git(String),
    /// Objects the command needed are not stored locally because the repository is a partial
    /// clone (`--filter=tree:0`, `--filter=blob:none`…), and this app does not fetch them.
    #[error("objects missing from a partial clone: {0}")]
    MissingObjects(String),
    #[error("internal error: {0}")]
    Internal(String),
}
