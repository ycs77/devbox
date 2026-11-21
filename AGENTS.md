# AGENTS.md

## Constraints

- Node.js v26
- TypeScript formatting: 2 spaces, single quotes, no semicolons, trailing commas

## Verification

Beyond `pnpm check`:

- **Packaging changes** (`package.json`, `bin/`, tsdown bundle, command registration): run `pnpm smoke`.
- **Before release**: run `pnpm smoke` and the `verify-devbox` skill.

## AI team

Each role runs in its namesake Herdr tab:

- **orchestrator**: Dispatch tasks across tabs and schedule review fixes at integration checkpoints.
- **plan**: Clarify scope and tradeoffs with the user; produce specs and tasks.
- **build**: Sole writer. Implement specs, pass `pnpm check`, commit, and report the hash to **orchestrator**.
- **review**: Read-only. Audit the specified revision against the spec and report findings to **orchestrator**.

## Agent skills

### Product brief

`docs/brief/` holds the developer's product intent; its goals bind every plan and change, while examples and open details are settled in ADRs and code. Read it before planning, and edit `docs/brief/` only with explicit permission. See `docs/agents/product-brief.md`.

### Issue tracker

Issues and PRDs live in GitHub Issues; external PRs are not a triage request surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo using root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Writing tests

When adding or changing tests, follow `docs/agents/writing-tests.md` for behaviour-first test selection, seam choice, failure-case priority, mocking, isolation, and verification.
