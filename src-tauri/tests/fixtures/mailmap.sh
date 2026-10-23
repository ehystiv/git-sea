#!/bin/sh
# Builds a repo in $1 where one person commits under two names and emails, and a .mailmap in the
# working copy (not committed) gives them one name. The last commit names her as a co-author.
set -eu
dir="$1"
mkdir -p "$dir"
cd "$dir"
git init -q -b main
commit() {
  echo "$3" > file.txt
  git add file.txt
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" \
    git -c commit.gpgsign=false commit -q -m "$3" -m "${4:-}"
}
commit "anna" "anna@old.example" "first"
commit "Anna Rossi" "anna@example.com" "second"
commit "Bruno" "bruno@example.com" "third" "Co-authored-by: anna <anna@old.example>"
printf 'Anna Rossi <anna@example.com> <anna@old.example>\n' > .mailmap
