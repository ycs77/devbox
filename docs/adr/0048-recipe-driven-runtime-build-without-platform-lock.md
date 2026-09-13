# Build Runtime images from packaged recipes without a Platform lock

## Status

ADR-0049 supersedes this ADR's `build.node` shape and deferred Project-specific selection, while ADR-0050 adds Configured Agent installation. The packaged-recipe Build flow without a Platform lock remains the current Runtime implementation direction.

## Decision

Devbox does not create, read, write, or maintain `~/.devbox/platform-lock.yaml`. A Platform lock is not part of the current product model.

Global configuration at `~/.devbox/config.yaml` declares the Node release lines included in the next Workspace build:

```yaml
version: 1
node: [22, 24]
agent: []
agent_notifications: false
```

Global `node` is the desired build set, not a Project's selected Runtime. ADR-0049 defines Local `node` as the Project-specific selection, restricted to a configured Global line or `null`.

The packaged Runtime recipe is the source of truth for each supported release line. The current Node recipe fixes these versions:

- Node `22`: `22.23.2`
- Node `24`: `24.19.0`

The Node recipe also owns the complete verified installation flow validated by `prototype/node/Dockerfile`: local Docker architecture mapping, official archive and signed-manifest coordinates derived from the recipe version, keyserver fallback, release-key fingerprints, signed-manifest verification, archive checksum verification, `.tar.xz` extraction, Runtime layout, OpenSSL-header removal, and the current Node global-tool installation sequence:

```sh
npm install -g npm@latest corepack@latest @antfu/ni@latest
corepack enable pnpm
npm install -g -f yarn
```

Yarn remains the v1 installation path. These tools are Build-time Runtime contents, are not lockfile entries, and are not independently version-pinned by Project state.

`build` reads the Global `node` set, combines it with the packaged recipes, renders the single Workspace Dockerfile, and invokes the validated one-build prototype flow. The build uses the local Docker architecture; Devbox does not persist a top-level target platform in a lockfile. Runtime source verification remains inside Docker Build, and the archive checksum and observed signer are transient verification results.

The Base image, curated APT package plan, APT bootstrap sequence, CA bootstrap, HTTPS source switch, Base digest, Runtime source URLs, and release-key policy are recipe/build inputs rather than persisted Platform-lock fields. The live APT and upstream source behavior validated by the prototype remains the implementation reference.

## Consequences

- Changing Global `node` changes the Runtime set assembled by the next Workspace build.
- Updating a packaged recipe can change the exact Runtime version used by a later build without changing a Project lockfile; this is intentional in the current recipe-driven model.
- There is no host-side Node release-index resolution stage and no Platform-lock publication or failure-preservation contract.
- The former `update` Platform-lock workflow is obsolete and must not be reintroduced.
- Catalog validation remains required: Global configuration may name only release lines with packaged recipes.
- PHP and future artifact pinning remain deferred until separate decisions exist. Local configuration and Project-specific Node selection are defined by ADR-0049.
- The prototype is the authoritative Runtime-build behavior reference when older ADR text conflicts with this decision.
