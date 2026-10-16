//! `.gitlab-ci.yml`: which pushes and merge requests would create a pipeline with at least one
//! job. `rules:if` expressions are evaluated on the predefined variables a push or a merge request
//! would set; a condition on anything else (project variables, changed files) counts as true.

use std::collections::HashMap;

use regex::Regex;
use serde_yaml_ng::{Mapping, Value};

use super::RefName;
use super::pattern::slashed_regex;

/// Top-level keys that are settings, not jobs.
const RESERVED: &[&str] = &[
    "stages",
    "variables",
    "default",
    "include",
    "workflow",
    "image",
    "services",
    "before_script",
    "after_script",
    "cache",
    "types",
    "spec",
];

#[derive(Debug)]
pub struct Pipeline {
    pub name: Option<String>,
    workflow_rules: Option<Vec<Rule>>,
    jobs: Vec<Job>,
    /// Some condition could not be decided from the ref alone.
    pub approximate: bool,
    pub events: Vec<String>,
}

#[derive(Debug, Default)]
struct Job {
    rules: Option<Vec<Rule>>,
    only: Option<Vec<RefItem>>,
    except: Option<Vec<RefItem>>,
}

#[derive(Debug)]
struct Rule {
    cond: Option<Expr>,
    never: bool,
}

#[derive(Debug)]
enum RefItem {
    Keyword(String),
    Name(String),
    Regex(Regex),
}

/// What a pipeline would be created for.
#[derive(Debug, Clone, Copy)]
pub enum Event<'a> {
    Push(RefName<'a>),
    MergeRequest { target: &'a str },
}

pub fn parse(text: &str) -> Result<Pipeline, String> {
    let mut doc: Value = serde_yaml_ng::from_str(text).map_err(|e| e.to_string())?;
    doc.apply_merge().map_err(|e| e.to_string())?;
    let Value::Mapping(map) = doc else {
        return Err("il file non è una mappa YAML".to_owned());
    };
    let mut approximate = false;

    let workflow = map.get("workflow").and_then(Value::as_mapping);
    let name = workflow
        .and_then(|w| w.get("name"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    let workflow_rules = workflow
        .and_then(|w| w.get("rules"))
        .map(|r| parse_rules(r, &mut approximate));

    let mut jobs = Vec::new();
    for (key, value) in &map {
        let Some(key) = key.as_str() else { continue };
        if key.starts_with('.') || RESERVED.contains(&key) {
            continue;
        }
        let Some(job) = value.as_mapping() else {
            continue;
        };
        let job = resolve_extends(&map, job, 0);
        jobs.push(parse_job(&job, &mut approximate));
    }

    let text_lower = text.to_lowercase();
    let mut events = vec!["push".to_owned()];
    if text_lower.contains("merge_request_event") || text_lower.contains("merge_requests") {
        events.push("merge_request".to_owned());
    }
    if text_lower.contains("\"schedule\"") || text_lower.contains("schedules") {
        events.push("schedule".to_owned());
    }
    if text_lower.contains("when: manual") || text_lower.contains("\"web\"") {
        events.push("manual".to_owned());
    }

    Ok(Pipeline {
        name,
        workflow_rules,
        jobs,
        approximate,
        events,
    })
}

/// The job with the keys of its `extends` templates under its own, as GitLab merges them.
fn resolve_extends(root: &Mapping, job: &Mapping, depth: u8) -> Mapping {
    let parents: Vec<&str> = match job.get("extends") {
        Some(Value::String(s)) => vec![s.as_str()],
        Some(Value::Sequence(list)) => list.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    };
    if parents.is_empty() || depth > 8 {
        return job.clone();
    }
    let mut merged = Mapping::new();
    for parent in parents {
        if let Some(template) = root.get(parent).and_then(Value::as_mapping) {
            for (k, v) in resolve_extends(root, template, depth + 1) {
                merged.insert(k, v);
            }
        }
    }
    for (k, v) in job {
        merged.insert(k.clone(), v.clone());
    }
    merged
}

fn parse_job(job: &Mapping, approximate: &mut bool) -> Job {
    Job {
        rules: job.get("rules").map(|r| parse_rules(r, approximate)),
        only: job.get("only").map(|v| parse_refs(v, approximate)),
        except: job.get("except").map(|v| parse_refs(v, approximate)),
    }
}

fn parse_rules(value: &Value, approximate: &mut bool) -> Vec<Rule> {
    let Some(list) = value.as_sequence() else {
        return Vec::new();
    };
    list.iter()
        .filter_map(Value::as_mapping)
        .map(|rule| {
            if rule.contains_key("changes") || rule.contains_key("exists") {
                *approximate = true;
            }
            let cond = rule.get("if").and_then(Value::as_str).map(|text| {
                parse_expr(text).unwrap_or_else(|| {
                    *approximate = true;
                    Expr::Unknown
                })
            });
            let never = rule.get("when").and_then(Value::as_str) == Some("never");
            Rule { cond, never }
        })
        .collect()
}

fn parse_refs(value: &Value, approximate: &mut bool) -> Vec<RefItem> {
    let list = match value {
        Value::Sequence(list) => list.clone(),
        Value::String(_) => vec![value.clone()],
        Value::Mapping(map) => {
            if map.contains_key("variables") || map.contains_key("changes") {
                *approximate = true;
            }
            match map.get("refs") {
                Some(Value::Sequence(list)) => list.clone(),
                Some(single @ Value::String(_)) => vec![single.clone()],
                // `only: {variables: …}` alone keeps the default refs.
                _ => vec![
                    Value::String("branches".to_owned()),
                    Value::String("tags".to_owned()),
                ],
            }
        }
        _ => Vec::new(),
    };
    list.iter()
        .filter_map(Value::as_str)
        .map(|item| {
            if let Some(body) = slashed_regex(item)
                && let Ok(re) = Regex::new(body)
            {
                return RefItem::Regex(re);
            }
            match item {
                "branches"
                | "tags"
                | "merge_requests"
                | "pushes"
                | "schedules"
                | "web"
                | "api"
                | "triggers"
                | "pipelines"
                | "external"
                | "chat"
                | "external_pull_requests" => RefItem::Keyword(item.to_owned()),
                _ => RefItem::Name(item.to_owned()),
            }
        })
        .collect()
}

impl Pipeline {
    pub fn triggers(&self, event: Event<'_>, default_branch: Option<&str>) -> bool {
        let vars = Vars::for_event(event, default_branch);
        let workflow = self.workflow_rules.as_ref().map(|r| eval_rules(r, &vars));
        if workflow == Some(false) {
            return false;
        }
        self.jobs.iter().any(|job| {
            if let Some(rules) = &job.rules {
                return eval_rules(rules, &vars);
            }
            match event {
                Event::MergeRequest { .. } => {
                    // Without `rules`, a job joins merge request pipelines only when the workflow
                    // creates them or it asks for them with `only: [merge_requests]`.
                    match &job.only {
                        Some(only) => refs_match(only, event) && !except(job, event),
                        None => workflow == Some(true),
                    }
                }
                Event::Push(_) => {
                    let only = job.only.as_ref().is_none_or(|only| refs_match(only, event));
                    only && !except(job, event)
                }
            }
        })
    }
}

fn except(job: &Job, event: Event<'_>) -> bool {
    job.except
        .as_ref()
        .is_some_and(|items| refs_match(items, event))
}

fn refs_match(items: &[RefItem], event: Event<'_>) -> bool {
    items.iter().any(|item| match (item, event) {
        (RefItem::Keyword(k), Event::Push(RefName::Branch(_))) => k == "branches" || k == "pushes",
        (RefItem::Keyword(k), Event::Push(RefName::Tag(_))) => k == "tags" || k == "pushes",
        (RefItem::Keyword(k), Event::MergeRequest { .. }) => k == "merge_requests",
        (RefItem::Name(n), Event::Push(r)) => n == r.name(),
        (RefItem::Regex(re), Event::Push(r)) => re.is_match(r.name()),
        _ => false,
    })
}

/// The first rule whose condition holds decides; none holding means no. A condition that cannot be
/// decided counts as holding, unless it would exclude the job (`when: never`).
fn eval_rules(rules: &[Rule], vars: &Vars) -> bool {
    for rule in rules {
        let holds = match &rule.cond {
            None => Some(true),
            Some(expr) => expr.eval(vars),
        };
        match holds {
            Some(true) => return !rule.never,
            Some(false) => continue,
            None if rule.never => continue,
            None => return true,
        }
    }
    false
}

// ---- variables ------------------------------------------------------------------------------

/// Predefined variables whose value (or absence) the event decides.
const CONTEXT_VARS: &[&str] = &[
    "CI_PIPELINE_SOURCE",
    "CI_COMMIT_BRANCH",
    "CI_COMMIT_TAG",
    "CI_COMMIT_REF_NAME",
    "CI_COMMIT_REF_SLUG",
    "CI_DEFAULT_BRANCH",
    "CI_MERGE_REQUEST_ID",
    "CI_MERGE_REQUEST_IID",
    "CI_MERGE_REQUEST_TARGET_BRANCH_NAME",
    "CI_MERGE_REQUEST_SOURCE_BRANCH_NAME",
    "CI_OPEN_MERGE_REQUESTS",
    "CI_EXTERNAL_PULL_REQUEST_IID",
];

#[derive(Debug, Clone, PartialEq)]
enum Val {
    Str(String),
    Null,
    Unknown,
}

struct Vars(HashMap<&'static str, Option<String>>);

impl Vars {
    fn for_event(event: Event<'_>, default_branch: Option<&str>) -> Vars {
        let mut map: HashMap<&'static str, Option<String>> = HashMap::new();
        for name in CONTEXT_VARS {
            map.insert(name, None);
        }
        let mut set = |k: &'static str, v: &str| {
            map.insert(k, Some(v.to_owned()));
        };
        match event {
            Event::Push(RefName::Branch(name)) => {
                set("CI_PIPELINE_SOURCE", "push");
                set("CI_COMMIT_BRANCH", name);
                set("CI_COMMIT_REF_NAME", name);
            }
            Event::Push(RefName::Tag(name)) => {
                set("CI_PIPELINE_SOURCE", "push");
                set("CI_COMMIT_TAG", name);
                set("CI_COMMIT_REF_NAME", name);
            }
            Event::MergeRequest { target } => {
                set("CI_PIPELINE_SOURCE", "merge_request_event");
                set("CI_MERGE_REQUEST_ID", "1");
                set("CI_MERGE_REQUEST_IID", "1");
                set("CI_MERGE_REQUEST_TARGET_BRANCH_NAME", target);
                // The source branch is not known: whatever depends on it stays undecided.
                map.remove("CI_COMMIT_REF_NAME");
                map.remove("CI_COMMIT_REF_SLUG");
                map.remove("CI_MERGE_REQUEST_SOURCE_BRANCH_NAME");
            }
        }
        // `$CI_OPEN_MERGE_REQUESTS` depends on the server; leave it undecided.
        map.remove("CI_OPEN_MERGE_REQUESTS");
        match default_branch {
            Some(branch) => {
                map.insert("CI_DEFAULT_BRANCH", Some(branch.to_owned()));
            }
            None => {
                map.remove("CI_DEFAULT_BRANCH");
            }
        }
        Vars(map)
    }

    fn get(&self, name: &str) -> Val {
        match self.0.get(name) {
            Some(Some(v)) => Val::Str(v.clone()),
            Some(None) => Val::Null,
            None => Val::Unknown,
        }
    }
}

// ---- expressions -----------------------------------------------------------------------------

#[derive(Debug)]
enum Expr {
    Or(Box<Expr>, Box<Expr>),
    And(Box<Expr>, Box<Expr>),
    Cmp(Operand, Op, Operand),
    Present(Operand),
    /// Could not be parsed: undecided.
    Unknown,
}

#[derive(Debug)]
enum Operand {
    Var(String),
    Str(String),
    Regex(String),
    Null,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Op {
    Eq,
    Ne,
    Match,
    NoMatch,
}

impl Operand {
    fn value(&self, vars: &Vars) -> Val {
        match self {
            Operand::Var(name) => vars.get(name),
            Operand::Str(s) | Operand::Regex(s) => Val::Str(s.clone()),
            Operand::Null => Val::Null,
        }
    }
}

impl Expr {
    /// Kleene logic: None is "cannot tell".
    fn eval(&self, vars: &Vars) -> Option<bool> {
        match self {
            Expr::Unknown => None,
            Expr::Or(a, b) => match (a.eval(vars), b.eval(vars)) {
                (Some(true), _) | (_, Some(true)) => Some(true),
                (Some(false), Some(false)) => Some(false),
                _ => None,
            },
            Expr::And(a, b) => match (a.eval(vars), b.eval(vars)) {
                (Some(false), _) | (_, Some(false)) => Some(false),
                (Some(true), Some(true)) => Some(true),
                _ => None,
            },
            Expr::Present(operand) => match operand.value(vars) {
                Val::Str(s) => Some(!s.is_empty()),
                Val::Null => Some(false),
                Val::Unknown => None,
            },
            Expr::Cmp(left, op, right) => {
                let l = left.value(vars);
                let r = right.value(vars);
                if l == Val::Unknown || r == Val::Unknown {
                    return None;
                }
                match op {
                    Op::Eq => Some(l == r),
                    Op::Ne => Some(l != r),
                    Op::Match | Op::NoMatch => {
                        let Val::Str(pattern) = r else {
                            return Some(*op == Op::NoMatch);
                        };
                        let body = slashed_regex(&pattern).unwrap_or(&pattern);
                        let re = Regex::new(body).ok()?;
                        let found = matches!(&l, Val::Str(s) if re.is_match(s));
                        Some(found == (*op == Op::Match))
                    }
                }
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Var(String),
    Str(String),
    Regex(String),
    Null,
    Op(Op),
    And,
    Or,
    Open,
    Close,
}

fn tokenize(text: &str) -> Option<Vec<Token>> {
    let chars: Vec<char> = text.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            ' ' | '\t' | '\n' | '\r' => i += 1,
            '(' => {
                tokens.push(Token::Open);
                i += 1;
            }
            ')' => {
                tokens.push(Token::Close);
                i += 1;
            }
            '$' => {
                let start = i + 1;
                let mut end = start;
                // `${VAR}` is accepted too.
                let braced = chars.get(start) == Some(&'{');
                if braced {
                    end += 1;
                }
                while end < chars.len() && (chars[end].is_alphanumeric() || chars[end] == '_') {
                    end += 1;
                }
                let name: String = chars[if braced { start + 1 } else { start }..end]
                    .iter()
                    .collect();
                if braced {
                    end += 1;
                }
                tokens.push(Token::Var(name));
                i = end;
            }
            '"' | '\'' => {
                let quote = c;
                let mut end = i + 1;
                let mut s = String::new();
                while end < chars.len() && chars[end] != quote {
                    if chars[end] == '\\' && end + 1 < chars.len() {
                        end += 1;
                    }
                    s.push(chars[end]);
                    end += 1;
                }
                tokens.push(Token::Str(s));
                i = end + 1;
            }
            '/' => {
                let mut end = i + 1;
                let mut s = String::from("/");
                while end < chars.len() && chars[end] != '/' {
                    if chars[end] == '\\' && end + 1 < chars.len() {
                        s.push('\\');
                        end += 1;
                    }
                    s.push(chars[end]);
                    end += 1;
                }
                s.push('/');
                end += 1;
                // Flags such as `i` are kept out of the pattern.
                let mut flags = String::new();
                while end < chars.len() && chars[end].is_ascii_alphabetic() {
                    flags.push(chars[end]);
                    end += 1;
                }
                if flags.contains('i') {
                    s = format!("/(?i){}", &s[1..]);
                }
                tokens.push(Token::Regex(s));
                i = end;
            }
            '=' | '!' => {
                let next = chars.get(i + 1).copied();
                let op = match (c, next) {
                    ('=', Some('=')) => Op::Eq,
                    ('!', Some('=')) => Op::Ne,
                    ('=', Some('~')) => Op::Match,
                    ('!', Some('~')) => Op::NoMatch,
                    _ => return None,
                };
                tokens.push(Token::Op(op));
                i += 2;
            }
            '&' if chars.get(i + 1) == Some(&'&') => {
                tokens.push(Token::And);
                i += 2;
            }
            '|' if chars.get(i + 1) == Some(&'|') => {
                tokens.push(Token::Or);
                i += 2;
            }
            'n' if chars[i..].starts_with(&['n', 'u', 'l', 'l']) => {
                tokens.push(Token::Null);
                i += 4;
            }
            _ => return None,
        }
    }
    Some(tokens)
}

fn parse_expr(text: &str) -> Option<Expr> {
    let tokens = tokenize(text)?;
    let mut pos = 0;
    let expr = parse_or(&tokens, &mut pos)?;
    (pos == tokens.len()).then_some(expr)
}

fn parse_or(tokens: &[Token], pos: &mut usize) -> Option<Expr> {
    let mut left = parse_and(tokens, pos)?;
    while tokens.get(*pos) == Some(&Token::Or) {
        *pos += 1;
        let right = parse_and(tokens, pos)?;
        left = Expr::Or(Box::new(left), Box::new(right));
    }
    Some(left)
}

fn parse_and(tokens: &[Token], pos: &mut usize) -> Option<Expr> {
    let mut left = parse_atom(tokens, pos)?;
    while tokens.get(*pos) == Some(&Token::And) {
        *pos += 1;
        let right = parse_atom(tokens, pos)?;
        left = Expr::And(Box::new(left), Box::new(right));
    }
    Some(left)
}

fn parse_atom(tokens: &[Token], pos: &mut usize) -> Option<Expr> {
    if tokens.get(*pos) == Some(&Token::Open) {
        *pos += 1;
        let inner = parse_or(tokens, pos)?;
        if tokens.get(*pos) != Some(&Token::Close) {
            return None;
        }
        *pos += 1;
        return Some(inner);
    }
    let left = operand(tokens.get(*pos)?)?;
    *pos += 1;
    if let Some(Token::Op(op)) = tokens.get(*pos) {
        *pos += 1;
        let right = operand(tokens.get(*pos)?)?;
        *pos += 1;
        return Some(Expr::Cmp(left, *op, right));
    }
    Some(Expr::Present(left))
}

fn operand(token: &Token) -> Option<Operand> {
    Some(match token {
        Token::Var(name) => Operand::Var(name.clone()),
        Token::Str(s) => Operand::Str(s.clone()),
        Token::Regex(s) => Operand::Regex(s.clone()),
        Token::Null => Operand::Null,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push(name: &str) -> Event<'_> {
        Event::Push(RefName::Branch(name))
    }

    #[test]
    fn jobs_without_rules_run_on_every_push_but_not_on_merge_requests() {
        let p = parse("test:\n  script: [make test]\n").unwrap();
        assert!(p.triggers(push("feature"), None));
        assert!(p.triggers(Event::Push(RefName::Tag("v1")), None));
        assert!(!p.triggers(Event::MergeRequest { target: "main" }, None));
    }

    #[test]
    fn rules_on_the_default_branch_and_merge_requests() {
        let text = r#"
deploy:
  script: [deploy]
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
test:
  script: [test]
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_TARGET_BRANCH_NAME =~ /^release/
"#;
        let p = parse(text).unwrap();
        assert!(p.triggers(push("main"), Some("main")));
        assert!(!p.triggers(push("feature"), Some("main")));
        assert!(p.triggers(
            Event::MergeRequest {
                target: "release-1"
            },
            Some("main")
        ));
        assert!(!p.triggers(Event::MergeRequest { target: "main" }, Some("main")));
    }

    #[test]
    fn workflow_rules_gate_the_whole_pipeline() {
        let text = r#"
workflow:
  rules:
    - if: $CI_COMMIT_TAG
      when: never
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH
build:
  script: [build]
"#;
        let p = parse(text).unwrap();
        assert!(p.triggers(push("feature"), None));
        assert!(!p.triggers(Event::Push(RefName::Tag("v1")), None));
        assert!(p.triggers(Event::MergeRequest { target: "main" }, None));
    }

    #[test]
    fn only_and_except_with_names_and_regexes() {
        let text = r#"
.base:
  only: [main, /^release\/.*$/]
deploy:
  extends: .base
  script: [deploy]
  except: [release/skip]
"#;
        let p = parse(text).unwrap();
        assert!(p.triggers(push("main"), None));
        assert!(p.triggers(push("release/1.0"), None));
        assert!(!p.triggers(push("release/skip"), None));
        assert!(!p.triggers(push("feature"), None));
    }

    #[test]
    fn unknown_variables_count_as_possible() {
        let p = parse("job:\n  script: [x]\n  rules:\n    - if: $DEPLOY == \"yes\"\n").unwrap();
        assert!(p.triggers(push("feature"), None));
        let p =
            parse("job:\n  script: [x]\n  rules:\n    - if: $DEPLOY\n      when: never\n").unwrap();
        assert!(!p.triggers(push("feature"), None));
    }
}
