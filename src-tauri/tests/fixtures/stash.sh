#!/bin/sh
# Builds a repo in $1 with two stashes on top of one commit: an automatic "WIP" one and a named one.
set -eu
dir="$1"
mkdir -p "$dir"
cd "$dir"
git init -q -b main
git config user.name "Fixture"
git config user.email "fixture@example.com"
git config commit.gpgsign false

echo one > a.txt && git add a.txt && git commit -q -m "base"
echo two > a.txt
git stash -q
echo three > a.txt
git stash push -q -m "named stash"
