#!/usr/bin/env bash
# Typesets every document here with Tectonic so that the TeX files they need end up in a cache
# folder, shipped with the program for typesetting without the internet.
#   build-cache.sh <tectonic executable> <cache folder>
set -u
tectonic=$1
export TECTONIC_CACHE_DIR=$2
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
cp "$here"/*.tex "$here"/*.bib "$here"/../tex55/* "$work"/
cd "$work"
failed=0
for f in "$here"/*.tex; do
  name=$(basename "$f")
  case $name in common.tex|fonts.tex|type1.tex) continue ;; esac  # pieces the others \input
  if "$tectonic" -c minimal -Z continue-on-errors "$name" > "$name.out" 2>&1 && [ -f "${name%.tex}.pdf" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name"; tail -5 "$name.out"; failed=1
  fi
done
exit $failed
