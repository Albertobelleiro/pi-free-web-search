# Release Process

This project follows Semantic Versioning and Keep a Changelog.

## 1) Prepare release branch

- Update `CHANGELOG.md`:
  - move relevant entries from `Unreleased` into the target version section
  - add release date (`YYYY-MM-DD`)
- Bump `package.json` version
- Ensure docs reflect user-visible changes

## 2) Verify locally

```bash
bun run check
bun run smoke
FREE_WEB_SMOKE_MODE=disabled FREE_WEB_SMOKE_ALLOW_OFFLINE=1 bun run smoke
```

## 3) Merge to main

Use normal PR flow and wait for CI to pass.

## 4) Tag and publish GitHub release

```bash
git checkout main
git pull --ff-only origin main
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

Create a GitHub release from the tag:

- use **Generate release notes**
- ensure title/notes align with `CHANGELOG.md`
- mark as pre-release only when applicable

## 5) Post-release

- update `CHANGELOG.md` compare links if needed
- verify release artifacts/notes
- announce release in project channels
