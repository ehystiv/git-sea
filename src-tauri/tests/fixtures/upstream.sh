#!/bin/sh
# Builds a repo in $1 whose local branches track remote ones, set up by hand (no real remote):
# main tracks origin/main, topic tracks origin/renamed, feature tracks nothing.
set -eu
dir="$1"
mkdir -p "$dir"
cd "$dir"
git init -q -b main
git config user.name "Fixture"
git config user.email "fixture@example.com"
git config commit.gpgsign false
git config remote.origin.url /nowhere
git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"

git commit -q --allow-empty -m "base"
git update-ref refs/remotes/origin/main HEAD
git config branch.main.remote origin
git config branch.main.merge refs/heads/main
git commit -q --allow-empty -m "local only"

git branch topic
git update-ref refs/remotes/origin/renamed HEAD
git config branch.topic.remote origin
git config branch.topic.merge refs/heads/renamed

git branch feature
