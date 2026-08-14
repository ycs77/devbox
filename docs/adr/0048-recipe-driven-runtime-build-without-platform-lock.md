# Build Runtime images from packaged recipes without a Platform lock

## Status

Current decision as of 2026-08-14. This ADR supersedes the Platform-lock, exact-source-resolution, and Node-tool-placement portions of ADR-0034, ADR-0035, ADR-0036, ADR-0039, ADR-0041, ADR-0043, ADR-0047, and the related Issue #16/#17 contracts. Historical ADR text remains as design history; this ADR is the current implementation direction.

## Decision

Devbox does not create, read, write, or maintain `~/.devbox/platform-lock.yaml`. A Platform lock is not part of the current product model.

The user-owned Global configuration at `~/.devbox/config.yaml` declares the Runtime release lines included in the next Workspace build:

```yaml
build:
  node: [22, 24]
```

`build.node` is the desired build set, not a Project's selected Runtime. Project-specific Runtime selection is deferred to a future Project configuration contract and is not implemented in this stage.

The packaged Runtime recipe is the source of truth for each supported release line. The current Node recipe fixes these versions:

- Node `22`: `22.23.2`
- Node `24`: `24.19.0`

The Node recipe also owns the complete verified installation flow validated by `prototype/node/Dockerfile`: local Docker architecture mapping, official archive and signed-manifest coordinates derived from the recipe version, keyserver fallback, release-key fingerprints, signed-manifest verification, archive checksum verification, `.tar.xz` extraction, Runtime layout, OpenSSL-header cleanup, and the current Node global-tool installation sequence:

```sh
npm install -g npm@latest corepack@latest @antfu/ni@latest
corepack enable pnpm
npm install -g -f yarn
```

Yarn remains the v1 installation path. These tools are Build-time Runtime contents, are not lockfile entries, and are not independently version-pinned by Project state.

`build` reads the Global `build.node` set, combines it with the packaged recipes, renders the single Workspace Dockerfile, and invokes the validated one-build prototype flow. The build uses the local Docker architecture; Devbox does not persist a top-level target platform in a lockfile. Runtime source verification remains inside Docker Build, and the archive checksum and observed signer are transient verification results.

The Base image, curated APT package plan, APT bootstrap sequence, CA bootstrap, HTTPS source switch, Base digest, Runtime source URLs, and release-key policy are recipe/build inputs rather than persisted Platform-lock fields. The live APT and upstream source behavior validated by the prototype remains the implementation reference.

## Consequences

- Changing `build.node` changes the Runtime set assembled by the next Workspace build.
- Updating a packaged recipe can change the exact Runtime version used by a later build without changing a Project lockfile; this is intentional in the current recipe-driven model.
- There is no host-side Node release-index resolution stage and no Platform-lock publication or failure-preservation contract.
- The existing `update` Platform-lock workflow is obsolete for this direction and must not be implemented as part of Issue #16.
- Catalog validation remains required: Global configuration may name only release lines with packaged recipes.
- PHP, Project-specific Runtime selection, Local configuration, and future artifact pinning remain deferred until separate decisions exist.
- The prototype is the authoritative behavior reference when older ADR text conflicts with this decision.
