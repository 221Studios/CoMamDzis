# Project Instructions

- Before any coding, build, release, or repository action, run `git pull --rebase origin main`.
- Immediately before every commit, run `git fetch origin main` and confirm the current branch is not behind; if it is behind, rebase onto `origin/main` before committing.
- Do not commit real logins, passwords, access tokens, session cookies, or temporary scraping output.
- Skrypty testowe USOS/WSEIT/Pollub/Merito biorą poświadczenia wyłącznie ze zmiennych środowiskowych (`scripts/lib/test-credentials.mjs`). Lokalne konta: `danewrazliwe.txt` (gitignored) lub `.env` (gitignored).
- The release APK is versioned and named `CDV-Plan-<version>.apk`; rebuild it after app changes and verify it before pushing.
- Do not create or commit a second unversioned `CDV-Plan.apk` release copy.
- Keep `Podręcznik użytkownika Comamdziś.docx` updated when user-facing app features, login flows, settings, supported universities, or troubleshooting guidance change.
