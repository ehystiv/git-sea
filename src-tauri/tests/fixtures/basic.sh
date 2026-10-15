#!/bin/sh
# Builds a small repo in $1: two commits on main, a feature branch, a tag.
set -eu
dir="$1"
mkdir -p "$dir"
cd "$dir"
git init -q -b main
git config user.name "Fixture"
git config user.email "fixture@example.com"
git config commit.gpgsign false
echo one > a.txt && git add a.txt && git commit -q -m "first"
echo two > a.txt && git commit -q -am "second"
git tag v0.1.0
git branch feature
