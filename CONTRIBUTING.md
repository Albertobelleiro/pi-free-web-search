# Contributing to pi-free-web-search

Thanks for your interest in contributing ❤️

We welcome bug reports, docs improvements, tests, refactors, and feature proposals.

## Before you start

1. Read the [README](./README.md) for architecture and setup.
2. Check open issues and pull requests to avoid duplicate work.
3. For larger changes, open an issue first so we can align on scope.

## Development setup

```bash
git clone https://github.com/Albertobelleiro/pi-free-web-search.git
cd pi-free-web-search
bun install
```

### Verify locally

```bash
bun run check
bun run smoke
```

For deterministic CI-like smoke mode:

```bash
FREE_WEB_SMOKE_MODE=disabled FREE_WEB_SMOKE_ALLOW_OFFLINE=1 bun run smoke
```

## Branching and commits

- Create a focused branch from `main`.
- Keep commits small and meaningful.
- Use clear commit messages (Conventional Commit style is preferred):
  - `feat: ...`
  - `fix: ...`
  - `docs: ...`
  - `chore: ...`
  - `test: ...`

## Pull request checklist

Before opening a PR:

- [ ] `bun run check` passes
- [ ] smoke test passes in at least one mode
- [ ] new behavior has tests (or rationale if not feasible)
- [ ] README/docs updated for user-visible changes
- [ ] CHANGELOG updated for notable changes

When opening the PR, include:

- What changed
- Why it changed
- How you tested it
- Any follow-up work

## Coding guidelines

- Prefer simple, explicit code over clever abstractions.
- Keep fallback paths safe and observable.
- Treat network and browser operations as failure-prone.
- Preserve deterministic behavior in tests.

## Testing guidance

- Unit tests go in `tests/*.test.ts`.
- Favor fixtures/mocks over live network dependencies.
- If adding parser logic, include fixture coverage.

## Security

Please do **not** open public issues for security vulnerabilities.

See [SECURITY.md](./SECURITY.md) for reporting instructions.
