#!/bin/sh
# Builds a repo in $1 with two unrelated histories (two roots, two tips).
set -eu
dir="$1"
mkdir -p "$dir"
cd "$dir"
git init -q -b main
git config user.name "Fixture"
git config user.email "fixture@example.com"
git config commit.gpgsign false

commit() { echo "$1" > "$1.txt" && git add "$1.txt" && git commit -q -m "$1"; }

commit main1
commit main2
git checkout -q --orphan other
git rm -rfq .
commit other1
commit other2
git checkout -q main
