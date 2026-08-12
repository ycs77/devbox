# Return to one pnpm package

ADR-0045 removes the planned Go `devbox-host` helper. Without a separately published helper or platform package, Devbox no longer needs a pnpm workspace monorepo. The repository returns to one pnpm-managed package, published as `@ycs77/devbox`.

## Decision

The repository has one package boundary at its root:

- The root `package.json` is the `@ycs77/devbox` package manifest and the only publishable package manifest.
- The root `pnpm-lock.yaml` is the only dependency lockfile.
- The CLI source, tests, build and quality tooling, recipes, and package assets belong to that package.
- `pnpm` remains the package manager, and development scripts run from the repository root without `pnpm -C` package indirection.
- There is no `pnpm-workspace.yaml`, `packages/*` package graph, `@ycs77/devbox-linux-x64` platform package, `native/devbox-host` Go module, or helper-specific release choreography.
- Installation, versioning, packing, and publication have one package boundary. There is no helper compatibility range and no multi-package publication sequence to coordinate.

This is a package-boundary decision. It does not change Devbox's TypeScript CLI direction, Runtime or Sandbox domain model, or the command-marker behavior in ADR-0045.

If a future requirement introduces a second publishable package, a native helper, or a workspace package graph, that change requires a new ADR. Historical helper-backed files that remain during migration are cleanup residue, not a compatibility boundary to preserve.

## Consequences

The repository has a smaller dependency and release surface: one package manifest, one package lockfile, one build/test/check entry point, and one npm release boundary. The former platform-package versioning, helper protocol compatibility, cross-package publication ordering, and Go build distribution concerns no longer apply to the current design.

The CLI package can keep its internal module boundaries without turning each implementation area into a separately managed package. A future package split remains possible, but it must be justified by a concrete boundary rather than by the retired helper design.
