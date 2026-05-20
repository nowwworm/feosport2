---
name: build-windows-installer
description: build, compile, create Windows installer EXE; GitHub Actions build-installer.yml workflow; FeoSport2-Setup.exe
---

# build-windows-installer

FeoSport2 Windows installer (FeoSport2-Setup.exe) is built via GitHub Actions on `windows-latest` runner using **Inno Setup 6**. The workflow: compiles backend Node.js → EXE (via @vercel/pkg), bundles frontend React build, TMX SPA, and PostgreSQL 16 installer, then runs ISCC to create the final `.exe`.

The workflow is triggered manually (`workflow_dispatch`) or automatically on `git tag v*` (semantic versioning).

---

## Trigger the build (manual)

Via GitHub UI:
1. Go to GitHub → **Actions** → **Build Windows Installer**
2. Click **Run workflow** → choose branch (`main`)
3. Watch the live logs

Via `gh` CLI:
```bash
gh workflow run build-installer.yml --ref main
```

---

## Monitor build progress

```bash
# List recent runs (need `gh` CLI installed + authenticated)
gh run list --workflow build-installer.yml --limit 3

# Watch latest run live
RUN_ID=$(gh run list --workflow build-installer.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch $RUN_ID

# Download artifact when done
gh run download $RUN_ID --name FeoSport2-Setup
# Outputs: FeoSport2-Setup.exe
```

---

## What the workflow builds (step-by-step)

| Step | Input | Tool | Output | Size |
|------|-------|------|--------|------|
| **Backend** | `backend/src/server-bundled.js` | @vercel/pkg (node20-win-x64) | `feosport2-server.exe` | ~45 MB |
| **Frontend** | `frontend/src/**` | Vite build | `frontend-dist/` | ~200 KB |
| **TMX** | `feoTEST/TMX/**` | pnpm + vite | `tmx-dist/` | ~500 KB |
| **SQL** | `database/*.sql` | copy | `staging/database/` | — |
| **Installer** | `feosport2.iss` | Inno Setup 6 (ISCC) | `FeoSport2-Setup.exe` | ~150 MB |

All staging files are copied to `deploy/windows/build/staging/` before ISCC runs.

---

## Local dry-run (Windows only)

If you're on Windows and want to test locally without GitHub Actions:

```powershell
# 1. Install prerequisites
# choco install nodejs --version=22.0.0
# choco install innosetup --version=6.3.3
# npm install -g @vercel/pkg

# 2. Build backend
cd backend
npm ci
$out = "..\deploy\windows\build\staging\app\feosport2-server.exe"
New-Item -ItemType Directory -Force -Path "..\deploy\windows\build\staging\app\scripts" | Out-Null
pkg src/server-bundled.js --target node20-win-x64 --output $out --compress GZip

# 3. Build frontend
cd ..\frontend
npm ci
npm run build
Copy-Item "dist\*" "..\deploy\windows\build\staging\frontend-dist" -Recurse -Force

# 4. Copy SQL
Copy-Item "database\*.sql" "deploy\windows\build\staging\database" -Force

# 5. Run Inno Setup
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" deploy\windows\build\feosport2.iss

# Final exe: deploy\windows\output\FeoSport2-Setup.exe
```

---

## Build configuration files

| File | Purpose |
|------|---------|
| `.github/workflows/build-installer.yml` | GitHub Actions workflow (trigger + step orchestration) |
| `deploy/windows/build/feosport2.iss` | Inno Setup script (installer UI, file layout, custom dialogs) |
| `backend/src/server-bundled.js` | Entry point for pkg compilation (handles exe path, serves frontend) |
| `deploy/windows/build/bundled-scripts/setup-db.ps1` | Post-install PowerShell script (DB initialization, seed data) |
| `deploy/windows/build/bundled-scripts/*.bat` | Batch scripts (start, stop, seed shortcuts) |

---

## Troubleshooting workflow

### Build stage fails: Backend

**Error:** `pkg: target not found`
- **Cause:** `@vercel/pkg` not installed globally or wrong version
- **Fix:** Workflow installs it fresh in step "Install @vercel/pkg globally" — ensure this step succeeds

**Error:** `pkg src/server-bundled.js exited with code 1`
- **Cause:** Syntax error or missing dependency in `server-bundled.js`
- **Fix:** Check `backend/src/server-bundled.js` for `require()` calls. Ensure all deps are in `package.json`

### Build stage fails: Frontend

**Error:** `vite build` exits with error
- **Cause:** Missing env var `VITE_API_URL` or TypeScript errors
- **Fix:** Workflow sets `VITE_API_URL: ''` (empty) for production. If custom needed, edit workflow

### Build stage fails: TMX

**Error:** `feoTEST/TMX not found — skipping TMX build`
- **Cause:** TMX directory is intentionally optional (skippable if not present)
- **Fix:** If you want TMX in the build, ensure `feoTEST/TMX/` is in git (no `.git/` inside)

**Error:** `pnpm: command not found`
- **Cause:** pnpm not installed in workflow
- **Fix:** Workflow step "Setup pnpm" should run first. Check it doesn't fail

### Build stage fails: ISCC

**Error:** `ISCC.exe not found`
- **Cause:** Inno Setup 6 not installed (choco install failed)
- **Fix:** Step "Install Inno Setup 6" uses `choco install innosetup`. Verify no timeout

**Error:** `ISCC exited with code 1`
- **Cause:** `.iss` script syntax error or file reference missing
- **Fix:** Common issues:
  - Missing file: check `deploy/windows/build/staging/app/feosport2-server.exe` was created
  - Missing dir: check `deploy/windows/build/bundled-scripts/` exists on disk before ISCC runs
  - `.iss` syntax: edit `deploy/windows/build/feosport2.iss` and check lines around `Source:` directives

### Artifact upload fails

**Error:** `If-no-files-found: error`
- **Cause:** Installer not created at `deploy/windows/output/FeoSport2-Setup.exe`
- **Fix:** ISCC step must complete successfully. Check previous steps for errors

---

## How to debug (.iss file issues)

Edit `deploy/windows/build/feosport2.iss`. Common sections:

```ini
[Files]
; Path is relative to the .iss file location (deploy/windows/build/)
Source: "staging\app\feosport2-server.exe";  DestDir: "{app}"   ; ✓ Correct
Source: "staging\frontend-dist\*";           DestDir: "{app}\frontend-dist"; Recurse

[Run]
; PowerShell script passed as parameter
Filename: "powershell.exe";
  Parameters: "-ExecutionPolicy Bypass -File ""{app}\setup-db.ps1"" ...";
```

When testing locally, ensure relative paths resolve from the directory containing `.iss`.

---

## Env vars in workflow

Set in `.github/workflows/build-installer.yml`:

```yaml
env:
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'  # Skip large Playwright binaries
  ELECTRON_SKIP_BINARY_DOWNLOAD: '1'     # Skip Electron binaries (TMX may use)
  CI: 'true'                             # For build tools to detect CI mode
  BASE_URL: 'tmx'                        # TMX SPA path
  VITE_API_URL: ''                       # Empty = serve frontend-only (no API)
```

---

## PostgreSQL installer caching

The workflow caches the PostgreSQL 16 installer (~300 MB) to speed up builds:

```yaml
- name: Cache PostgreSQL installer
  uses: actions/cache@v4
  with:
    path: deploy/windows/build/deps/postgresql-16-win-x64.exe
    key: postgresql-16.3-1-win-x64
```

If cache invalidates (PostgreSQL updated), the workflow re-downloads. This adds ~2 min to the build.

---

## Artifact retention

Artifacts (`.exe`) are kept for **30 days** by default:

```yaml
retention-days: 30
```

After 30 days, GitHub auto-deletes. To keep longer or reduce storage, edit:

```yaml
retention-days: 7  # or 90, etc.
```

---

## Gotchas

- **Build takes ~25–30 minutes** — @vercel/pkg compilation is slow, network download of PostgreSQL adds time
- **Inno Setup is Windows-only** — workflow runs on `windows-latest` (cannot run on macOS/Linux)
- **Port 8090 hardcoded in app** — installer runs backend on 8090. Cannot easily change post-install
- **PostgreSQL password during install** — user is prompted. Default password can be set in `.iss` code section (see `feosport2.iss` lines 143–160)
- **Registry paths Windows-specific** — `.iss` uses `{pf}` (Program Files), `{userstartup}`, etc. Not portable to other OS

---

## Release workflow (tag → build)

To auto-trigger installer on tag:

```bash
git tag v1.0.0
git push origin v1.0.0
# Automatically triggers workflow (on: push tags: 'v*')
```

View triggered run in Actions tab.
