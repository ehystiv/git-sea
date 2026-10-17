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

    /// The hosting service's name and the address of a commit's page without the commit id, for
    /// the services whose URL scheme is known.
    pub fn commit_page(&self) -> Option<RepoWeb> {
        let (name, prefix) = if self.is_github() {
            ("GitHub", format!("{}/commit/", self.web()))
        } else if self.is_gitlab() {
            ("GitLab", format!("{}/-/commit/", self.web()))
        } else if self.is_bitbucket() {
            ("Bitbucket", format!("{}/commits/", self.web()))
        } else if let Some((org, project, repo)) = self.azure() {
            (
                "Azure DevOps",
                format!("https://dev.azure.com/{org}/{project}/_git/{repo}/commit/"),
            )
        } else {
            return None;
        };
        Some(RepoWeb {
            name: name.to_owned(),
            commit_url: prefix,
        })
    }
}

/// Where the commits of a repository can be seen on the web.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RepoWeb {
    /// The service, as shown to the user ("GitHub").
    pub name: String,
    /// A commit's page is this followed by the full commit id.
    pub commit_url: String,
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
    fn builds_commit_pages_for_the_known_services() {
        let page = |url: &str| parse(url).and_then(|r| r.commit_page());
        let github = page("git@github.com:owner/repo.git").unwrap();
        assert_eq!(github.name, "GitHub");
        assert_eq!(github.commit_url, "https://github.com/owner/repo/commit/");
        assert_eq!(
            page("https://gitlab.com/group/sub/repo.git")
                .unwrap()
                .commit_url,
            "https://gitlab.com/group/sub/repo/-/commit/"
        );
        assert_eq!(
            page("git@bitbucket.org:ws/repo.git").unwrap().commit_url,
            "https://bitbucket.org/ws/repo/commits/"
        );
        assert_eq!(
            page("git@ssh.dev.azure.com:v3/org/project/repo")
                .unwrap()
                .commit_url,
            "https://dev.azure.com/org/project/_git/repo/commit/"
        );
        assert_eq!(page("git@example.org:a/b.git"), None);
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
