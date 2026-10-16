//! Branch and tag name patterns as the CI systems write them, and filters made of them.

use regex::Regex;

/// One pattern for a branch or tag name.
#[derive(Debug, Clone)]
pub enum Pattern {
    Any,
    Exact(String),
    Regex(Regex),
}

impl Pattern {
    pub fn matches(&self, name: &str) -> bool {
        match self {
            Pattern::Any => true,
            Pattern::Exact(exact) => exact == name,
            Pattern::Regex(re) => re.is_match(name),
        }
    }

    /// GitHub Actions filter pattern: `*` stops at `/`, `**` does not, `?` and `+` repeat the
    /// character before them (as in a regex), `[...]` is a character class, `\` escapes.
    pub fn github(pattern: &str) -> Pattern {
        let mut out = String::from("^");
        let mut chars = pattern.chars().peekable();
        let mut plain = true;
        while let Some(c) = chars.next() {
            match c {
                '*' if chars.peek() == Some(&'*') => {
                    chars.next();
                    out.push_str(".*");
                    plain = false;
                }
                '*' => {
                    out.push_str("[^/]*");
                    plain = false;
                }
                '?' | '+' => {
                    out.push(c);
                    plain = false;
                }
                '[' => {
                    out.push('[');
                    for c in chars.by_ref() {
                        out.push(c);
                        if c == ']' {
                            break;
                        }
                    }
                    plain = false;
                }
                '\\' => {
                    if let Some(next) = chars.next() {
                        out.push_str(&regex::escape(&next.to_string()));
                    }
                }
                _ => out.push_str(&regex::escape(&c.to_string())),
            }
        }
        out.push('$');
        if plain {
            return Pattern::Exact(pattern.replace('\\', ""));
        }
        Regex::new(&out).map_or_else(|_| Pattern::Exact(pattern.to_owned()), Pattern::Regex)
    }

    /// Shell-style glob: `**` matches anything, `*` anything but `/` (anything at all when
    /// `star_crosses_slash`), `?` one character, `{a,b}` either.
    pub fn glob(pattern: &str, star_crosses_slash: bool) -> Pattern {
        if pattern == "*" || pattern == "**" {
            return Pattern::Any;
        }
        let mut out = String::from("^");
        let mut chars = pattern.chars().peekable();
        let mut plain = true;
        let mut in_braces = false;
        while let Some(c) = chars.next() {
            match c {
                '*' if chars.peek() == Some(&'*') => {
                    chars.next();
                    out.push_str(".*");
                    plain = false;
                }
                '*' => {
                    out.push_str(if star_crosses_slash { ".*" } else { "[^/]*" });
                    plain = false;
                }
                '?' => {
                    out.push('.');
                    plain = false;
                }
                '{' => {
                    out.push('(');
                    in_braces = true;
                    plain = false;
                }
                '}' if in_braces => {
                    out.push(')');
                    in_braces = false;
                }
                ',' if in_braces => out.push('|'),
                _ => out.push_str(&regex::escape(&c.to_string())),
            }
        }
        out.push('$');
        if plain {
            return Pattern::Exact(pattern.to_owned());
        }
        Regex::new(&out).map_or_else(|_| Pattern::Exact(pattern.to_owned()), Pattern::Regex)
    }

    /// A name, or a regex between slashes (`/^release-.*/`), as CircleCI and Travis write them.
    /// `anchored` makes the regex match the whole name (CircleCI) instead of any part (Travis).
    pub fn slashed(pattern: &str, anchored: bool) -> Pattern {
        match slashed_regex(pattern) {
            Some(body) => {
                let body = if anchored {
                    format!("^(?:{body})$")
                } else {
                    body.to_owned()
                };
                Regex::new(&body)
                    .map_or_else(|_| Pattern::Exact(pattern.to_owned()), Pattern::Regex)
            }
            None => Pattern::Exact(pattern.to_owned()),
        }
    }
}

/// The body of `/body/`, or None when `pattern` is not written between slashes.
pub fn slashed_regex(pattern: &str) -> Option<&str> {
    let body = pattern.strip_prefix('/')?;
    let end = body.rfind('/')?;
    Some(&body[..end])
}

/// Patterns applied in order; the last one matching a name decides. A name no pattern matches is
/// left out, so an empty filter matches nothing.
#[derive(Debug, Clone)]
pub enum Filter {
    Rules(Vec<Rule>),
    /// Matches what any of these filters matches.
    Union(Vec<Filter>),
}

#[derive(Debug, Clone)]
pub struct Rule {
    exclude: bool,
    pattern: Pattern,
}

impl Filter {
    pub fn never() -> Filter {
        Filter::Rules(Vec::new())
    }

    pub fn always() -> Filter {
        Filter::Rules(vec![Rule {
            exclude: false,
            pattern: Pattern::Any,
        }])
    }

    /// Everything in `include` (everything at all when None) that is not in `exclude`.
    pub fn include_exclude(include: Option<Vec<Pattern>>, exclude: Vec<Pattern>) -> Filter {
        let include = include.unwrap_or_else(|| vec![Pattern::Any]);
        let rules = include
            .into_iter()
            .map(|pattern| Rule {
                exclude: false,
                pattern,
            })
            .chain(exclude.into_iter().map(|pattern| Rule {
                exclude: true,
                pattern,
            }))
            .collect();
        Filter::Rules(rules)
    }

    /// GitHub's list where a pattern starting with `!` takes names out again.
    pub fn github_ordered<'a>(patterns: impl IntoIterator<Item = &'a str>) -> Filter {
        let rules = patterns
            .into_iter()
            .map(|p| match p.strip_prefix('!') {
                Some(rest) => Rule {
                    exclude: true,
                    pattern: Pattern::github(rest),
                },
                None => Rule {
                    exclude: false,
                    pattern: Pattern::github(p),
                },
            })
            .collect();
        Filter::Rules(rules)
    }

    pub fn any(filters: Vec<Filter>) -> Filter {
        Filter::Union(filters)
    }

    pub fn matches(&self, name: &str) -> bool {
        match self {
            Filter::Rules(rules) => {
                let mut result = false;
                for rule in rules {
                    if rule.pattern.matches(name) {
                        result = !rule.exclude;
                    }
                }
                result
            }
            Filter::Union(filters) => filters.iter().any(|f| f.matches(name)),
        }
    }

    /// Whether it matches nothing whatever the name.
    pub fn is_never(&self) -> bool {
        match self {
            Filter::Rules(rules) => rules.iter().all(|r| r.exclude),
            Filter::Union(filters) => filters.iter().all(Filter::is_never),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_patterns_follow_the_documented_examples() {
        let p = Pattern::github("feature/*");
        assert!(p.matches("feature/my-branch"));
        assert!(!p.matches("feature/your/branch"));
        let p = Pattern::github("feature/**");
        assert!(p.matches("feature/your/branch"));
        let p = Pattern::github("v[12].[0-9]+.[0-9]+");
        assert!(p.matches("v1.10.1"));
        assert!(!p.matches("v3.0.0"));
        let p = Pattern::github("main");
        assert!(p.matches("main"));
        assert!(!p.matches("main2"));
        let p = Pattern::github("**-alpha");
        assert!(p.matches("mona/octocat-alpha"));
    }

    #[test]
    fn github_negations_apply_in_order() {
        let f = Filter::github_ordered(["releases/**", "!releases/**-alpha"]);
        assert!(f.matches("releases/10"));
        assert!(!f.matches("releases/10-alpha"));
        assert!(!f.matches("main"));
    }

    #[test]
    fn globs_and_slashed_regexes() {
        assert!(Pattern::glob("feature/*", false).matches("feature/a"));
        assert!(!Pattern::glob("feature/*", false).matches("feature/a/b"));
        assert!(Pattern::glob("feature/*", true).matches("feature/a/b"));
        assert!(Pattern::glob("{main,develop}", false).matches("develop"));
        assert!(Pattern::slashed("/v\\d+/", true).matches("v12"));
        assert!(!Pattern::slashed("/v\\d+/", true).matches("tag-v12"));
        assert!(Pattern::slashed("/v\\d+/", false).matches("tag-v12"));
        assert!(Pattern::slashed("main", true).matches("main"));
    }

    #[test]
    fn exclusions_win_over_inclusions() {
        let f = Filter::include_exclude(None, vec![Pattern::Exact("gh-pages".into())]);
        assert!(f.matches("main"));
        assert!(!f.matches("gh-pages"));
        assert!(!Filter::never().matches("main"));
        assert!(Filter::never().is_never());
        assert!(!Filter::always().is_never());
    }
}
