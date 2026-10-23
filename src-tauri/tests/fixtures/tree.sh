#!/bin/sh
# Builds a repo in $1 with nested directories, an executable, a symlink, a binary file and a
# submodule pointer, over two commits:
#   first    README.md, src/main.rs, src/util/mod.rs
#   second   removes src/util, adds run.sh (executable), link -> README.md, logo.bin and vendor
#            (a submodule entry, written straight into the index)
set -eu
dir="$1"
mkdir -p "$dir"
cd "$dir"
git init -q -b main
git config user.name "Fixture"
git config user.email "fixture@example.com"
git config commit.gpgsign false

printf '# Title\r\n\r\nText\n' > README.md
mkdir -p src/util
printf 'fn main() {}\n' > src/main.rs
printf 'pub fn util() {}\n' > src/util/mod.rs
git add . && git commit -q -m "first"

git rm -q -r src/util
printf '#!/bin/sh\necho hi\n' > run.sh
chmod +x run.sh
ln -s README.md link
printf 'PNG\000\001\002' > logo.bin
git add run.sh link logo.bin
git update-index --add --cacheinfo 160000,1111111111111111111111111111111111111111,vendor
git commit -q -m "second"
