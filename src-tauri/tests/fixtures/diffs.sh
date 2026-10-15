#!/bin/sh
# Builds a repo in $1 whose commits each show one kind of change:
#   add      two new files (one text, one binary)
#   modify   edit a.txt: change line 2, append a line
#   rename   move b.txt to dir/c.txt with a small edit, delete a.txt
#   merge    merge of a branch that adds side.txt, with a message body
set -eu
dir="$1"
mkdir -p "$dir"
cd "$dir"
git init -q -b main
git config user.name "Fixture"
git config user.email "fixture@example.com"
git config commit.gpgsign false

printf 'one\ntwo\nthree\n' > a.txt
printf 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\ntheta\n' > b.txt
printf 'PNG\000\001\002' > image.bin
git add . && git commit -q -m "add"

printf 'one\nTWO\nthree\nfour\n' > a.txt
git commit -q -am "modify"

mkdir dir
git mv b.txt dir/c.txt
printf 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\nTHETA\n' > dir/c.txt
git rm -q a.txt
git add -A && git commit -q -m "rename"

git checkout -q -b side
echo side > side.txt && git add side.txt && git commit -q -m "side work"
git checkout -q main
echo main > main.txt && git add main.txt && git commit -q -m "main work"
git merge -q --no-ff side -m "Merge side" -m "Body line one.

Body line two."
