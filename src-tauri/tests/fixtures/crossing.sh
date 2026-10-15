#!/bin/sh
# Builds a repo in $1 with interleaved branches that cross each other:
# a and b both fork from base, are merged into main at different times, and a keeps going.
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
git checkout -q -b a
commit a1
git checkout -q main
git checkout -q -b b
commit b1
git checkout -q main
commit m1
git merge -q --no-ff a -m "Merge a"
git checkout -q b
commit b2
git checkout -q main
commit m2
git merge -q --no-ff b -m "Merge b"
git checkout -q a
commit a2
git checkout -q main
