#!/bin/sh
# Builds a repo in $1 with $2 empty commits in a straight line on main, using fast-import.
set -eu
dir="$1"
count="$2"
mkdir -p "$dir"
cd "$dir"
git init -q -b main
i=1
while [ "$i" -le "$count" ]; do
  msg="commit $i"
  printf 'commit refs/heads/main\ncommitter Fixture <fixture@example.com> %d +0000\ndata %d\n%s\n' \
    "$((1700000000 + i))" "${#msg}" "$msg"
  i=$((i + 1))
done | git fast-import --quiet
