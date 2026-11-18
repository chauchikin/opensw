# texwarm

Documents the Windows build typesets once with Tectonic so that the TeX files they need are
already in the program (`texcache/`): typesetting then works without the internet.
They cover what opensw writes (its LaTeX export, Scientific Word 5.x documents with the
macro files in `tex55/`) and the fonts, sizes, packages and bibliography styles those use.
A document that needs something else still works when the computer is online: Tectonic
downloads the missing files the first time.

`build-cache.sh <tectonic> <cache folder>` runs them (see `.github/workflows/windows.yml`).
