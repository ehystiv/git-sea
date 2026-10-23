#!/bin/sh
# Builds in $1 a bare remote ($1/remote.git) and a clone of it ($1/work):
#   old         pushed, tracked by the local `old`, then deleted on the remote
#   keep        still on the remote, at main (so merged too)
#   local-only  a local branch with its own commit and no upstream
#   merged      a local branch at main~1, no upstream, already held by HEAD (main)
set -eu
dir="$1"
mkdir -p "$dir"
git init -q --bare -b main "$dir/remote.git"
git clone -q "$dir/remote.git" "$dir/work" 2>/dev/null
cd "$dir/work"
git config user.name "Fixture"
git config user.email "fixture@example.com"
git config commit.gpgsign false

git commit -q --allow-empty -m "one"
git commit -q --allow-empty -m "two"
git push -q origin main
git checkout -q -b old
git commit -q --allow-empty -m "old work"
git push -q -u origin old 2>/dev/null
git checkout -q -b keep main
git push -q -u origin keep 2>/dev/null
git checkout -q -b local-only main
git commit -q --allow-empty -m "local work"
git branch merged main~1
git checkout -q main
git -C "$dir/remote.git" branch -q -D old
