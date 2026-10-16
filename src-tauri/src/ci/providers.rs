//! Reading each CI system's files into the triggers git-sea can place on the graph: which branch
//! and tag pushes start a workflow, and which target branches a pull request / merge request
//! starts it for. Conditions on changed files, variables or expressions are not evaluated; such
//! workflows are marked approximate.

use serde_yaml_ng::{Mapping, Value};

use super::pattern::{Filter, Pattern};
use super::{CiProvider, Definition, Matcher, gitlab};

fn load(text: &str) -> Result<Mapping, String> {
    let mut doc: Value = serde_yaml_ng::from_str(text).map_err(|e| e.to_string())?;
    doc.apply_merge().map_err(|e| e.to_string())?;
    match doc {
        Value::Mapping(map) => Ok(map),
        Value::Null => Ok(Mapping::new()),
        _ => Err("il file non è una mappa YAML".to_owned()),
    }
}

/// A string or a list of strings.
fn strings(value: Option<&Value>) -> Option<Vec<String>> {
    match value? {
        Value::String(s) => Some(vec![s.clone()]),
        Value::Sequence(list) => Some(
            list.iter()
                .filter_map(|v| match v {
                    Value::String(s) => Some(s.clone()),
                    Value::Number(n) => Some(n.to_string()),
                    _ => None,
                })
                .collect(),
        ),
        _ => None,
    }
}

fn file_stem(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.')
        .map_or(name, |(stem, _)| stem)
        .to_owned()
}

// ---- GitHub Actions --------------------------------------------------------------------------

pub fn github(path: &str, text: &str) -> Result<Definition, String> {
    let doc = load(text)?;
    let name = doc
        .get("name")
        .and_then(Value::as_str)
        .map_or_else(|| file_stem(path), str::to_owned);
    // YAML 1.1 parsers read `on` as `true`; accept both spellings of the key.
    let on = doc.get("on").or_else(|| doc.get(Value::Bool(true)));

    let mut events: Vec<(String, Option<&Mapping>)> = Vec::new();
    match on {
        Some(Value::String(event)) => events.push((event.clone(), None)),
        Some(Value::Sequence(list)) => {
            events.extend(
                list.iter()
                    .filter_map(Value::as_str)
                    .map(|e| (e.to_owned(), None)),
            );
        }
        Some(Value::Mapping(map)) => {
            for (key, value) in map {
                if let Some(event) = key.as_str() {
                    events.push((event.to_owned(), value.as_mapping()));
                }
            }
        }
        _ => {}
    }

    let mut approximate = false;
    let mut branches = Filter::never();
    let mut tags = Filter::never();
    let mut merge = Filter::never();
    for (event, config) in &events {
        match event.as_str() {
            "push" => {
                let get = |k: &str| config.and_then(|c| c.get(k));
                if get("paths").is_some() || get("paths-ignore").is_some() {
                    approximate = true;
                }
                let has_branches = get("branches").is_some() || get("branches-ignore").is_some();
                let has_tags = get("tags").is_some() || get("tags-ignore").is_some();
                branches = github_filter(get("branches"), get("branches-ignore"), has_tags);
                tags = github_filter(get("tags"), get("tags-ignore"), has_branches);
            }
            "pull_request" | "pull_request_target" => {
                let get = |k: &str| config.and_then(|c| c.get(k));
                if get("paths").is_some() || get("paths-ignore").is_some() {
                    approximate = true;
                }
                merge = github_filter(get("branches"), get("branches-ignore"), false);
            }
            _ => {}
        }
    }
    Ok(Definition {
        provider: CiProvider::GitHub,
        name,
        path: path.to_owned(),
        events: events.into_iter().map(|(e, _)| e).collect(),
        approximate,
        matcher: Matcher::Filters {
            branches,
            tags,
            merge,
        },
    })
}

/// `branches` / `branches-ignore` (or the tag pair). With neither, everything matches, unless the
/// other kind of ref is filtered: then this kind does not trigger at all.
fn github_filter(include: Option<&Value>, ignore: Option<&Value>, other_filtered: bool) -> Filter {
    if let Some(list) = strings(include) {
        return Filter::github_ordered(list.iter().map(String::as_str));
    }
    if let Some(list) = strings(ignore) {
        return Filter::include_exclude(None, list.iter().map(|p| Pattern::github(p)).collect());
    }
    if other_filtered {
        Filter::never()
    } else {
        Filter::always()
    }
}

// ---- GitLab CI -------------------------------------------------------------------------------

pub fn gitlab(path: &str, text: &str) -> Result<Definition, String> {
    let pipeline = gitlab::parse(text)?;
    Ok(Definition {
        provider: CiProvider::GitLab,
        name: pipeline
            .name
            .clone()
            .unwrap_or_else(|| "GitLab CI".to_owned()),
        path: path.to_owned(),
        events: pipeline.events.clone(),
        approximate: pipeline.approximate,
        matcher: Matcher::GitLab(Box::new(pipeline)),
    })
}

// ---- CircleCI --------------------------------------------------------------------------------

/// One definition per workflow of `.circleci/config.yml`.
pub fn circleci(path: &str, text: &str) -> Result<Vec<Definition>, String> {
    let doc = load(text)?;
    let Some(workflows) = doc.get("workflows").and_then(Value::as_mapping) else {
        // CircleCI 2.0 without workflows runs the job called `build` on every branch.
        if doc
            .get("jobs")
            .and_then(Value::as_mapping)
            .is_some_and(|jobs| jobs.contains_key("build"))
        {
            return Ok(vec![Definition {
                provider: CiProvider::CircleCi,
                name: "build".to_owned(),
                path: path.to_owned(),
                events: vec!["push".to_owned()],
                approximate: false,
                matcher: Matcher::Filters {
                    branches: Filter::always(),
                    tags: Filter::never(),
                    merge: Filter::never(),
                },
            }]);
        }
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for (key, value) in workflows {
        let (Some(name), Some(workflow)) = (key.as_str(), value.as_mapping()) else {
            continue;
        };
        let scheduled = workflow
            .get("triggers")
            .and_then(Value::as_sequence)
            .is_some_and(|t| !t.is_empty());
        let approximate = workflow.contains_key("when") || workflow.contains_key("unless");

        // A push starts the workflow when at least one of its jobs accepts the ref.
        let mut branch_filters = Vec::new();
        let mut tag_filters = Vec::new();
        for job in workflow
            .get("jobs")
            .and_then(Value::as_sequence)
            .into_iter()
            .flatten()
        {
            let filters = job
                .as_mapping()
                .and_then(|m| m.values().next())
                .and_then(|config| config.get("filters"));
            let branches = filters.and_then(|f| f.get("branches"));
            let tags = filters.and_then(|f| f.get("tags"));
            branch_filters.push(circle_filter(branches, true));
            tag_filters.push(circle_filter(tags, false));
        }

        let (branches, tags) = if scheduled {
            (Filter::never(), Filter::never())
        } else {
            (Filter::any(branch_filters), Filter::any(tag_filters))
        };
        let mut events = Vec::new();
        if !scheduled {
            events.push("push".to_owned());
        } else {
            events.push("schedule".to_owned());
        }
        out.push(Definition {
            provider: CiProvider::CircleCi,
            name: name.to_owned(),
            path: path.to_owned(),
            events,
            approximate,
            matcher: Matcher::Filters {
                branches,
                tags,
                merge: Filter::never(),
            },
        });
    }
    Ok(out)
}

/// `only` / `ignore` of a CircleCI filter. Without a filter, branches all run and tags none.
fn circle_filter(filter: Option<&Value>, default_all: bool) -> Filter {
    let only = strings(filter.and_then(|f| f.get("only")));
    let ignore = strings(filter.and_then(|f| f.get("ignore"))).unwrap_or_default();
    // `tags: {ignore: …}` alone still runs no tag.
    if only.is_none() && !default_all {
        return Filter::never();
    }
    Filter::include_exclude(
        only.map(|list| list.iter().map(|p| Pattern::slashed(p, true)).collect()),
        ignore.iter().map(|p| Pattern::slashed(p, true)).collect(),
    )
}

// ---- Azure Pipelines -------------------------------------------------------------------------

pub fn azure(path: &str, text: &str) -> Result<Definition, String> {
    let doc = load(text)?;
    let mut approximate = false;
    let mut events = Vec::new();

    let (branches, tags) = match doc.get("trigger") {
        // No `trigger`: every branch.
        None => (Filter::always(), Filter::never()),
        Some(Value::String(s)) if s == "none" => (Filter::never(), Filter::never()),
        Some(value) => {
            if value.get("paths").is_some() {
                approximate = true;
            }
            azure_refs(value)
        }
    };
    if !branches.is_never() || !tags.is_never() {
        events.push("push".to_owned());
    }
    let merge = match doc.get("pr") {
        None => Filter::always(),
        Some(Value::String(s)) if s == "none" => Filter::never(),
        Some(value) => {
            if value.get("paths").is_some() {
                approximate = true;
            }
            azure_refs(value).0
        }
    };
    if !merge.is_never() {
        events.push("pull_request".to_owned());
    }
    if doc.contains_key("schedules") {
        events.push("schedule".to_owned());
    }
    Ok(Definition {
        provider: CiProvider::Azure,
        name: file_stem(path),
        path: path.to_owned(),
        events,
        approximate,
        matcher: Matcher::Filters {
            branches,
            tags,
            merge,
        },
    })
}

/// Branch and tag filters of an Azure `trigger` or `pr`: a list, or `branches` / `tags` with
/// `include` / `exclude`. Names may carry `refs/heads/` or `refs/tags/`.
fn azure_refs(value: &Value) -> (Filter, Filter) {
    let split = |list: Vec<String>| {
        let mut branches = Vec::new();
        let mut tags = Vec::new();
        for item in list {
            if let Some(tag) = item.strip_prefix("refs/tags/") {
                tags.push(Pattern::glob(tag, true));
            } else {
                let branch = item.strip_prefix("refs/heads/").unwrap_or(&item);
                branches.push(Pattern::glob(branch, true));
            }
        }
        (branches, tags)
    };
    if let Some(list) = strings(Some(value)) {
        let (branches, tags) = split(list);
        let tags = if tags.is_empty() {
            Filter::never()
        } else {
            Filter::include_exclude(Some(tags), Vec::new())
        };
        return (Filter::include_exclude(Some(branches), Vec::new()), tags);
    }
    let section = |key: &str, prefix: &str| -> Filter {
        let Some(section) = value.get(key) else {
            return if key == "branches" {
                Filter::always()
            } else {
                Filter::never()
            };
        };
        let strip = |p: &String| Pattern::glob(p.strip_prefix(prefix).unwrap_or(p), true);
        let include = strings(section.get("include")).map(|l| l.iter().map(strip).collect());
        let exclude = strings(section.get("exclude"))
            .unwrap_or_default()
            .iter()
            .map(strip)
            .collect();
        Filter::include_exclude(include, exclude)
    };
    (
        section("branches", "refs/heads/"),
        section("tags", "refs/tags/"),
    )
}

// ---- Bitbucket Pipelines ---------------------------------------------------------------------

pub fn bitbucket(path: &str, text: &str) -> Result<Definition, String> {
    let doc = load(text)?;
    let pipelines = doc.get("pipelines").and_then(Value::as_mapping);
    let section = |key: &str| -> Vec<Pattern> {
        pipelines
            .and_then(|p| p.get(key))
            .and_then(Value::as_mapping)
            .map(|m| {
                m.keys()
                    .filter_map(Value::as_str)
                    .map(|glob| Pattern::glob(glob, false))
                    .collect()
            })
            .unwrap_or_default()
    };
    let has_default = pipelines.is_some_and(|p| p.contains_key("default"));
    let branch_globs = section("branches");
    let tag_globs = section("tags");
    let pr_globs = section("pull-requests");

    // `default` runs for every branch that no `branches` entry covers.
    let branches = if has_default {
        Filter::always()
    } else if branch_globs.is_empty() {
        Filter::never()
    } else {
        Filter::include_exclude(Some(branch_globs), Vec::new())
    };
    let tags = if tag_globs.is_empty() {
        Filter::never()
    } else {
        Filter::include_exclude(Some(tag_globs), Vec::new())
    };
    // Pull request pipelines match the source branch, which the graph does not know.
    let merge = if pr_globs.is_empty() {
        Filter::never()
    } else {
        Filter::always()
    };

    let mut events = Vec::new();
    if !branches.is_never() || !tags.is_never() {
        events.push("push".to_owned());
    }
    if !merge.is_never() {
        events.push("pull_request".to_owned());
    }
    if pipelines.is_some_and(|p| p.contains_key("custom")) {
        events.push("manual".to_owned());
    }
    Ok(Definition {
        provider: CiProvider::Bitbucket,
        name: "Bitbucket Pipelines".to_owned(),
        path: path.to_owned(),
        events,
        approximate: !pr_globs.is_empty(),
        matcher: Matcher::Filters {
            branches,
            tags,
            merge,
        },
    })
}

// ---- Travis CI -------------------------------------------------------------------------------

pub fn travis(path: &str, text: &str) -> Result<Definition, String> {
    let doc = load(text)?;
    let section = doc.get("branches");
    let only = strings(section.and_then(|s| s.get("only")))
        // `branches: [a, b]` is short for `only`.
        .or_else(|| strings(section));
    let except = strings(section.and_then(|s| s.get("except"))).unwrap_or_default();
    // Travis treats tags as branch names in these filters, and the regexes match anywhere.
    let filter = Filter::include_exclude(
        only.map(|l| l.iter().map(|p| Pattern::slashed(p, false)).collect()),
        except.iter().map(|p| Pattern::slashed(p, false)).collect(),
    );
    Ok(Definition {
        provider: CiProvider::Travis,
        name: "Travis CI".to_owned(),
        path: path.to_owned(),
        events: vec!["push".to_owned(), "pull_request".to_owned()],
        approximate: doc.contains_key("if") || doc.contains_key("jobs"),
        matcher: Matcher::Filters {
            branches: filter.clone(),
            tags: filter.clone(),
            merge: filter,
        },
    })
}

// ---- Jenkins ---------------------------------------------------------------------------------

/// A `Jenkinsfile` is a program: assume a multibranch job, which builds every branch and every
/// pull request.
pub fn jenkins(path: &str) -> Definition {
    Definition {
        provider: CiProvider::Jenkins,
        name: "Jenkins".to_owned(),
        path: path.to_owned(),
        events: vec!["push".to_owned(), "pull_request".to_owned()],
        approximate: true,
        matcher: Matcher::Filters {
            branches: Filter::always(),
            tags: Filter::never(),
            merge: Filter::always(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::super::RefName;
    use super::*;

    fn push(def: &Definition, branch: &str) -> bool {
        def.on_push(RefName::Branch(branch), None)
    }
    fn tag(def: &Definition, name: &str) -> bool {
        def.on_push(RefName::Tag(name), None)
    }

    #[test]
    fn github_on_forms() {
        let d = github(".github/workflows/ci.yml", "on: push\njobs: {}\n").unwrap();
        assert_eq!(d.name, "ci");
        assert!(push(&d, "anything") && tag(&d, "v1"));
        assert!(!d.on_merge("main", None));

        let d = github("w.yml", "name: CI\non: [push, pull_request]\n").unwrap();
        assert_eq!(d.name, "CI");
        assert!(d.on_merge("main", None));

        let text = "on:\n  push:\n    branches: [main, 'releases/**']\n  pull_request:\n    branches: [main]\n";
        let d = github("w.yml", text).unwrap();
        assert!(push(&d, "main") && push(&d, "releases/1/2"));
        assert!(!push(&d, "feature"));
        assert!(!tag(&d, "v1"), "a branch filter alone means no tags");
        assert!(d.on_merge("main", None) && !d.on_merge("dev", None));
    }

    #[test]
    fn github_tags_only_and_ignores() {
        let d = github("w.yml", "on:\n  push:\n    tags: ['v*']\n").unwrap();
        assert!(tag(&d, "v1.0") && !tag(&d, "x"));
        assert!(!push(&d, "main"), "a tag filter alone means no branches");

        let d = github("w.yml", "on:\n  push:\n    branches-ignore: [gh-pages]\n").unwrap();
        assert!(push(&d, "main") && !push(&d, "gh-pages"));

        let d = github(
            "w.yml",
            "on:\n  workflow_dispatch:\n  schedule:\n    - cron: '0 0 * * *'\n",
        )
        .unwrap();
        assert!(!push(&d, "main"));
        assert_eq!(d.events, vec!["workflow_dispatch", "schedule"]);
    }

    #[test]
    fn circleci_workflows_and_filters() {
        let text = r#"
version: 2.1
workflows:
  build:
    jobs:
      - test
      - deploy:
          filters:
            branches: { ignore: /.*/ }
            tags: { only: /^v.*/ }
  nightly:
    triggers:
      - schedule: { cron: "0 0 * * *", filters: { branches: { only: main } } }
    jobs: [test]
"#;
        let defs = circleci(".circleci/config.yml", text).unwrap();
        assert_eq!(defs.len(), 2);
        let build = &defs[0];
        assert!(push(build, "feature"));
        assert!(tag(build, "v1.2") && !tag(build, "x1"));
        assert!(!push(&defs[1], "main"));
    }

    #[test]
    fn azure_triggers() {
        let d = azure("azure-pipelines.yml", "steps: []\n").unwrap();
        assert!(push(&d, "any") && d.on_merge("main", None));
        let d = azure(
            "azure-pipelines.yml",
            "trigger:\n  - main\n  - releases/*\npr: none\n",
        )
        .unwrap();
        assert!(push(&d, "releases/a/b") && !push(&d, "feature"));
        assert!(!d.on_merge("main", None));
        let text =
            "trigger:\n  branches:\n    include: [refs/heads/main]\n  tags:\n    include: ['v*']\n";
        let d = azure("azure-pipelines.yml", text).unwrap();
        assert!(push(&d, "main") && tag(&d, "v2") && !push(&d, "dev"));
    }

    #[test]
    fn bitbucket_sections() {
        let text =
            "pipelines:\n  branches:\n    'feature/*': []\n    main: []\n  tags:\n    'v*': []\n";
        let d = bitbucket("bitbucket-pipelines.yml", text).unwrap();
        assert!(push(&d, "main") && push(&d, "feature/x") && !push(&d, "feature/x/y"));
        assert!(!push(&d, "dev"));
        assert!(tag(&d, "v1"));
        let d = bitbucket("bitbucket-pipelines.yml", "pipelines:\n  default: []\n").unwrap();
        assert!(push(&d, "dev") && !tag(&d, "v1"));
    }

    #[test]
    fn travis_branches() {
        let d = travis(".travis.yml", "branches:\n  only: [main, /^v\\d/]\n").unwrap();
        assert!(push(&d, "main") && tag(&d, "v1.0") && !push(&d, "dev"));
        assert!(d.on_merge("main", None));
        let d = travis(".travis.yml", "language: rust\n").unwrap();
        assert!(push(&d, "dev"));
    }
}
