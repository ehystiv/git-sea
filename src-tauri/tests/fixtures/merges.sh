#!/bin/sh
# Builds a repo in $1 with a merge commit, an octopus merge, an annotated tag and a
# branch that is not merged: main <- feature (--no-ff), main <- a, b, c (octopus), side.
set -eu
dir="$1"
mkdir -p "$dir"
cd "$dir"
git init -q -b main
git config user.name "Fixture"
git config user.email "fixture@example.com"
git config commit.gpgsign false

commit() { echo "$1" > "$1.txt" && git add "$1.txt" && git commit -q -m "$1"; }

commit base
git checkout -q -b feature
commit f1
commit f2
git checkout -q main
commit m1
git merge -q --no-ff feature -m "Merge feature"
git tag -a v1 -m "annotated"

for b in a b c; do
  git checkout -q -b "$b" main
  commit "$b"1
done
git checkout -q main
commit m2
git merge -q a b c -m "Octopus merge"

git checkout -q -b side main~1
commit s1
git checkout -q main
