#!/bin/sh
# Builds a repo in $1 for the `diff:` search (git log -S):
#   add      app.js calls fetchUser once
#   reorder  moves lines around: fetchUser appears as often as before
#   second   adds a second call to fetchUser
#   other    edits notes.txt only
#   remove   removes both calls
#   move     renames notes.txt, which mentions fetchUser
set -eu
dir="$1"
mkdir -p "$dir"
cd "$dir"
git init -q -b main
git config user.name "Fixture"
git config user.email "fixture@example.com"
git config commit.gpgsign false

printf 'import x\nconst u = fetchUser(id);\nrender(u);\n' > app.js
printf 'see fetchUser\n' > notes.txt
git add . && git commit -q -m "add"

printf 'render(u);\nconst u = fetchUser(id);\nimport x\n' > app.js
git commit -q -am "reorder"

printf 'render(u);\nconst u = fetchUser(id);\nconst v = fetchUser(other);\nimport x\n' > app.js
git commit -q -am "second"

printf 'see fetchUser\nmore\n' > notes.txt
git commit -q -am "other"

printf 'render(u);\nimport x\n' > app.js
git commit -q -am "remove"

git mv notes.txt NOTES.md
git commit -q -m "move"
