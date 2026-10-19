#!/bin/sh
# Builds a repo in $1 where a file is renamed partway through its history:
#   create   old.txt with lines a, b, c
#   edit     changes line b to B
#   other    adds other.txt only
#   move     renames old.txt to new.txt, same content
#   after    appends line d to new.txt
set -eu
dir="$1"
mkdir -p "$dir"
cd "$dir"
git init -q -b main
git config user.name "Fixture"
git config user.email "fixture@example.com"
git config commit.gpgsign false

printf 'a\nb\nc\n' > old.txt
git add . && git commit -q -m "create"

printf 'a\nB\nc\n' > old.txt
git commit -q -am "edit"

echo other > other.txt && git add other.txt && git commit -q -m "other"

git mv old.txt new.txt
git commit -q -m "move"

printf 'a\nB\nc\nd\n' > new.txt
git commit -q -am "after"
