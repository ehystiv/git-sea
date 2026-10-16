#!/bin/sh
# Builds a repo in $1 with CI files: two GitHub workflows (one with a branch filter), a GitLab
# pipeline, a broken Travis file, a branch `feature`, a tag `v1` and a remote pointing at GitHub.
set -eu
dir="$1"
mkdir -p "$dir"
cd "$dir"
git init -q -b main
git config user.name "Fixture"
git config user.email "fixture@example.com"
git config commit.gpgsign false
git remote add origin git@github.com:owner/project.git

mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'YAML'
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
YAML
cat > .github/workflows/release.yaml <<'YAML'
on:
  push:
    tags: ['v*']
YAML
echo "not a workflow" > .github/workflows/README.md
cat > .gitlab-ci.yml <<'YAML'
test:
  script: [make test]
  rules:
    - if: $CI_COMMIT_BRANCH == "feature"
YAML
printf 'branches: [unclosed\n' > .travis.yml
git add -A
git commit -q -m "ci"
git tag v1
git checkout -q -b feature
echo f > f.txt
git add f.txt
git commit -q -m "feature"
git checkout -q main
