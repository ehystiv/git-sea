#!/bin/sh
# Builds a repo in $1 with nested directories, an executable, a symlink, a binary file and a
# submodule pointer, over two commits:
#   first    README.md, src/main.rs, src/util/mod.rs
#   second   removes src/util, adds run.sh (executable), link -> README.md, logo.bin and vendor
#            (a submodule entry)
# The executable, the symlink and the submodule are written straight into the index, so the repo
# is the same where the file system has no executable bit or symlinks (Windows); autocrlf is off
# so the CRLF of README.md stays as written.
set -eu
dir="$1"
mkdir -p "$dir"
cd "$dir"
git init -q -b main
git config user.name "Fixture"
git config user.email "fixture@example.com"
git config commit.gpgsign false
git config core.autocrlf false

printf '# Title\r\n\r\nText\n' > README.md
mkdir -p src/util
printf 'fn main() {}\n' > src/main.rs
printf 'pub fn util() {}\n' > src/util/mod.rs
git add . && git commit -q -m "first"

git rm -q -r src/util
printf 'PNG\000\001\002' > logo.bin
git add logo.bin
script=$(printf '#!/bin/sh\necho hi\n' | git hash-object -w --stdin)
target=$(printf 'README.md' | git hash-object -w --stdin)
git update-index --add --cacheinfo "100755,$script,run.sh"
git update-index --add --cacheinfo "120000,$target,link"
git update-index --add --cacheinfo 160000,1111111111111111111111111111111111111111,vendor
git commit -q -m "second"
