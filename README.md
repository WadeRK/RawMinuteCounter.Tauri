# Raw Minute Counter (Tauri)

Tauri + React + TypeScript rebuild.

Current scope:
- Config Search Roots screen only (first migration screen).

## Local Dev (UI only)

```bash
npm install
npm run dev
```

## Build EXE on GitHub (No local MSVC needed)

This repo includes:
- `.github/workflows/build-windows.yml`

How to use:
1. Push this project to GitHub.
2. Open `Actions` tab.
3. Run workflow: `Build Windows EXE` (or push to `main`).
4. Download artifact: `RawMinuteCounter-Windows`.

Artifact may contain:
- `*.exe` (NSIS)
- `*.msi`

## Notes

- Rust toolchain is required for local Tauri build.
- Local Windows build also needs Visual Studio Build Tools (MSVC + Windows SDK).
- GitHub Actions avoids that local disk/toolchain burden.
