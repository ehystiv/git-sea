//! Where a repository is hosted, read from its remote URL: the host and the project path the CI
//! services' APIs and web pages are addressed by.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteRepo {
    /// Lowercase host name, without user or port.
    pub host: String,
    /// Project path on the host (`owner/repo`, `group/subgroup/repo`), without `.git`.
    pub path: String,
}

impl RemoteRepo {
    pub fn is_github(&self) -> bool {
        self.host == "github.com" || self.host.starts_with("github.")
    }

    pub fn is_gitlab(&self) -> bool {
        self.host == "gitlab.com" || self.host.contains("gitlab")
    }

    pub fn is_bitbucket(&self) -> bool {
        self.host == "bitbucket.org"
    }

    /// Organization, project and repository of an Azure Repos remote.
    pub fn azure(&self) -> Option<(String, String, String)> {
        let parts: Vec<&str> = self.path.split('/').collect();
        if self.host == "dev.azure.com" || self.host == "ssh.dev.azure.com" {
            // https: org/project/_git/repo; ssh: v3/org/project/repo
            return match parts.as_slice() {
                [org, project, "_git", repo] | ["v3", org, project, repo] => {
                    Some(((*org).into(), (*project).into(), (*repo).into()))
                }
                _ => None,
            };
        }
        if let Some(org) = self.host.strip_suffix(".visualstudio.com") {
            return match parts.as_slice() {
                [project, "_git", repo] => Some((org.into(), (*project).into(), (*repo).into())),
                [_, project, "_git", repo] => Some((org.into(), (*project).into(), (*repo).into())),
                _ => None,
            };
        }
        None
    }

    /// The project's web page.
    pub fn web(&self) -> String {
        format!("https://{}/{}", self.host, self.path)
    }
}

/// Reads `git@host:path.git`, `ssh://user@host:port/path`, `https://user@host/path.git` and the like.
pub fn parse(url: &str) -> Option<RemoteRepo> {
    let url = url.trim();
    let (host, path) = if let Some((_, rest)) = url.split_once("://") {
        let (authority, path) = rest.split_once('/')?;
        let host = authority.rsplit('@').next()?;
        let host = host.split(':').next()?;
        (host, path)
    } else {
        // scp-like: [user@]host:path
        let (left, path) = url.split_once(':')?;
        if left.contains('/') {
            return None; // a local path
        }
        let host = left.rsplit('@').next()?;
        (host, path)
    };
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    if host.is_empty() || path.is_empty() {
        return None;
    }
    Some(RemoteRepo {
        host: host.to_ascii_lowercase(),
        path: path.to_owned(),
    })
}

/// The remote whose CI to look at: `origin` when there is one, else the first.
pub fn main_remote(repo: &gix::Repository) -> Option<RemoteRepo> {
    let names: Vec<String> = repo.remote_names().iter().map(|n| n.to_string()).collect();
    let name = names
        .iter()
        .find(|n| *n == "origin")
        .or_else(|| names.first())?;
    let remote = repo.find_remote(name.as_str()).ok()?;
    let url = remote.url(gix::remote::Direction::Fetch)?;
    parse(&url.to_bstring().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_usual_url_forms() {
        let expect = |url: &str, host: &str, path: &str| {
            assert_eq!(
                parse(url),
                Some(RemoteRepo {
                    host: host.into(),
                    path: path.into()
                }),
                "{url}"
            );
        };
        expect("git@github.com:owner/repo.git", "github.com", "owner/repo");
        expect("https://github.com/owner/repo", "github.com", "owner/repo");
        expect(
            "ssh://git@gitlab.example.com:2222/group/sub/repo.git",
            "gitlab.example.com",
            "group/sub/repo",
        );
        expect(
            "https://user@bitbucket.org/ws/repo.git",
            "bitbucket.org",
            "ws/repo",
        );
        assert_eq!(parse("/Users/me/repo"), None);
        assert_eq!(parse("../repo"), None);
    }

    #[test]
    fn finds_azure_projects() {
        let r = parse("https://org@dev.azure.com/org/project/_git/repo").unwrap();
        assert_eq!(
            r.azure(),
            Some(("org".into(), "project".into(), "repo".into()))
        );
        let r = parse("git@ssh.dev.azure.com:v3/org/project/repo").unwrap();
        assert_eq!(
            r.azure(),
            Some(("org".into(), "project".into(), "repo".into()))
        );
        let r = parse("https://org.visualstudio.com/project/_git/repo").unwrap();
        assert_eq!(
            r.azure(),
            Some(("org".into(), "project".into(), "repo".into()))
        );
        assert!(parse("https://github.com/a/b").unwrap().azure().is_none());
    }
}
