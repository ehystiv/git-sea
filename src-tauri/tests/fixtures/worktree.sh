#!/bin/sh
# Builds a repo in $1 with one commit and local changes of every kind:
#   staged.txt    modified and staged
#   both.txt      modified and staged, then modified again
#   unstaged.txt  modified, not staged
#   gone.txt      deleted, not staged
#   new.txt       new and staged
#   untracked.txt new, not staged
#   ignored.log   ignored, never listed
set -eu
dir="$1"
mkdir -p "$dir"
cd "$dir"
git init -q -b main
git config user.name "Fixture"
git config user.email "fixture@example.com"
git config commit.gpgsign false

printf '*.log\n' > .gitignore
for f in staged both unstaged gone; do printf 'one\ntwo\n' > "$f.txt"; done
git add . && git commit -q -m "base"

printf 'one\nTWO\n' > staged.txt
printf 'one\nTWO\n' > both.txt
echo new > new.txt
git add staged.txt both.txt new.txt
printf 'one\nTWO\nthree\n' > both.txt
printf 'one\ntwo\nthree\n' > unstaged.txt
rm gone.txt
echo untracked > untracked.txt
echo noise > ignored.log
