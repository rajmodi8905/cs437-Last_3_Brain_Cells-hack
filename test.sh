#!/bin/sh
# Fresh-clone test entrypoint: host Git supplies provenance; Docker runs all tests.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
command -v git >/dev/null 2>&1 || { echo 'Install Git, then clone this repository.' >&2; exit 1; }
docker compose version >/dev/null
docker info >/dev/null
memory=$(docker info --format '{{.MemTotal}}')
if [ "$memory" -lt 10000000000 ]; then
  echo 'Full real-model browser tests need at least 10 GB available to Docker.' >&2
  echo 'In Docker Desktop: Settings -> Resources -> Memory -> 10 GB, then Apply.' >&2
  echo 'Chromium private test profiles otherwise cannot cache the unchanged 445 MB models.' >&2
  echo 'The app itself can still run with: docker compose up --build --wait' >&2
  exit 2
fi

# Existing QA tests inspect HEAD and tracked files. Export only that actual shallow
# commit's objects and a fresh index, never the user's Git config, hooks or history.
mkdir -p .cache
temporary=$(mktemp -d "$PWD/.cache/checker-source.XXXXXX")
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
git init --quiet --bare "$temporary/repo"
git --git-dir="$temporary/repo" fetch --quiet --depth=1 --no-tags "$PWD" HEAD
GIT_INDEX_FILE="$temporary/index" git --git-dir="$temporary/repo" read-tree FETCH_HEAD
mkdir -p "$temporary/export/objects" "$temporary/export/refs"
git --git-dir="$temporary/repo" rev-parse FETCH_HEAD > "$temporary/export/HEAD"
cp "$temporary/repo/shallow" "$temporary/export/shallow"
cp "$temporary/index" "$temporary/export/index"
cp -R "$temporary/repo/objects/." "$temporary/export/objects/"
rm -rf .cache/checker-git
mv "$temporary/export" .cache/checker-git

docker compose --profile test run --build --rm tests
