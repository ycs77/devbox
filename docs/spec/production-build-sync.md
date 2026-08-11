# Production Build and Sync specification

## Historical status

This file is a superseded implementation snapshot retained only as historical design evidence. None of the Build, Sync, fingerprint, Base-image, lock-scope, public-command, readiness, or delivery-sequencing contracts below are current implementation targets.

The current contract has no public or internal Sync lifecycle, no Workspace fingerprints, no separately materialized Base image, and no post-build or Sandbox readiness gate. Implement from `CONTEXT.md` and the supersession entries in ADR-0001, ADR-0023, ADR-0025, ADR-0029 through ADR-0043; when this file conflicts with them, the ADRs are authoritative.

## Delivery sequencing

Production implementation proceeds as small, usable vertical slices rather than waiting for every future implementation contract to be complete. The completed first slice uses a committed Dockerfile for Node `24.19.0`, built by `node scripts/build-node-image.mjs` and tagged `devbox-node:24.19.0`. The current v0.x slice replaces that direct artifact path with the public `devbox init`, `sync`, `up`, `exec`, and `down` Node-only MVP: Build prepares verified Base, Node Runtime, and Workspace artifacts; Sync publishes retained Compose; `up` starts the Sandbox; `exec` runs the requested tool; and `down` removes only matching Sandbox resources. There is no public build command.

## Out of v0.x MVP scope

- PHP, other Runtime families, and Runtime selection;
- `devbox.yaml`, Local-configuration UI, Runtime updates, CLI release upgrades, and schema migration;
- AI Agents, Services, arbitrary host mounts, host Docker access, and host credential mounting;
- general Linux, macOS, `arm64`, native Windows, or cross-machine guarantees;
- npm publication and image garbage collection.

## Module map

```text
sync operation ─┐
                ├─ HostOperations ── devbox-host
up operation ───┘        │             (locks only)
          │              │
          └─ Sync module ├─ Configuration repositories
                         ├─ Platform resolver and repository
                         ├─ Build module
                         │    ├─ Recipe catalog
                         │    ├─ DockerProcess adapter
                         │    ├─ HostOperations fingerprint lock
                         │    └─ Temporary context adapter
                         └─ Compose renderer and repository
```

The CLI operation owns user-scope and Project lock lifetime. Sync owns desired-state synchronization. Build owns artifact identity and readiness. Adapters are internal seams; none are public CLI interfaces.

## Shared result and cancellation contract

Expected failures use a discriminated result:

```ts
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: DevboxError }

type DevboxError =
  | UsageError
  | ValidationError
  | OperationalError

interface ErrorData {
  readonly code: string
  readonly observed: string
  readonly nextAction?: string
  readonly cause?: unknown
}
```

Every asynchronous operation receives one operation-scoped `AbortSignal`. Expected validation, host-helper, filesystem, resolution, Docker, verification, and publication failures return `Result`; they do not throw or format terminal output. Exceptions are defects. The CLI presenter maps `DevboxError.kind` to the exit statuses in ADR-0023.

Ctrl-C aborts the operation, stops scheduling work, sends SIGINT to the active Docker child, and sends SIGKILL only if it remains after ten seconds. No new Platform activation or Compose write begins after cancellation. Verified stable tags and state committed before cancellation remain valid.

## HostOperations and lock capability

The TypeScript production adapter resolves the exported package metadata and helper asset from the independently versioned `@ycs77/devbox-linux-x64` dependency through Node package resolution. It requires the platform-package version to satisfy the helper range declared by the running CLI, converts the resolved helper URL to an absolute path, and starts that path directly without a shell or `PATH` lookup. It performs no separate hello exchange, pre-spawn access check, or per-launch binary hash: the first real `acquire` request and response validate protocol version 1, while a missing or non-executable helper, unsupported package version, malformed or wrong-version response, or premature exit fails before protected work with an instruction to reinstall the current exact CLI version. Module tests use a fake adapter; focused integration tests use the binary.

```ts
interface HostOperations {
  acquireProjectLocks(input: {
    project: RegisteredProject
    signal: AbortSignal
  }): Promise<Result<ProjectLockLease>>

  acquirePlatformMutationLock(input: {
    parent: ProjectLockLease | GlobalLockLease
    signal: AbortSignal
  }): Promise<Result<PlatformLockLease>>

  acquireFingerprintLock(input: {
    parent: ProjectLockLease | PlatformLockLease | GlobalLockLease
    fingerprint: string
    signal: AbortSignal
  }): Promise<Result<FingerprintLockLease>>
}
```

Lease values are opaque capabilities constructible only by the production or fake HostOperations adapter. A lease records its resource identity, parent scope, and released state. Sync rejects a lease for another Project or a released lease. Acquisitions follow lifecycle, Project, Platform mutation, then fingerprint order; releases run in reverse order.

Protocol version 1 is JSON Lines over one child process's stdin and stdout:

```ts
type HostRequest =
  | { version: 1; type: 'acquire'; locks: readonly LockRequest[] }
  | { version: 1; type: 'release' }

type HostResponse =
  | { version: 1; type: 'ready' }
  | { version: 1; type: 'released' }
  | {
      version: 1
      type: 'error'
      code: string
      operation: 'decode' | 'acquire' | 'release'
      resource?: string
      errno?: string
    }

type LockRequest = {
  readonly resource: string
  readonly rank: 'lifecycle' | 'project' | 'platform' | 'fingerprint'
  readonly mode: 'shared' | 'exclusive'
}
```

Stdout contains protocol messages only; diagnostics use stderr. The helper sorts and validates one request by canonical rank, reports `ready` only after every requested kernel lock is held, and keeps every file descriptor open until release, stdin EOF, or process exit. It has no daemon mode and no Project, Sync, Build, Docker, or presentation policy.

## Build module interface

```ts
interface Build {
  prepare(input: {
    plan: BuildPlan
    signal: AbortSignal
  }): Promise<Result<BuildResult>>
}

type PlatformInput =
  | { kind: 'active'; snapshot: PlatformSnapshot }
  | { kind: 'candidate'; snapshot: ResolvedPlatformCandidate }

interface BuildPlan {
  readonly platform: PlatformInput
  readonly workspaces: readonly WorkspaceRequest[]
}

interface WorkspaceRequest {
  readonly key: string
  readonly toolchain: Toolchain
}

interface BuildResult {
  readonly platform: PreparedPlatformSnapshot
  readonly base: PreparedBase
  readonly workspaces: ReadonlyMap<string, PreparedWorkspace>
}

interface PreparedBase {
  readonly tag: string
  readonly imageId: string
  readonly reused: boolean
}

interface PreparedWorkspace {
  readonly fingerprint: string
  readonly tag: string
  readonly reused: boolean
}
```

### Build plan invariants

- A plan contains exactly one active or candidate Platform snapshot.
- Every Runtime required by a requested Toolchain has one complete exact entry in that snapshot.
- A candidate contains fully resolved upstream revisions, digests, and package integrities. Only a newly materialized Base local image ID may still be absent; artifact recipe versions come from Build's injected packaged Recipe catalog rather than caller-supplied Platform state.
- Workspace request keys are non-empty and unique. Keys correlate results only and never participate in fingerprints, tags, Docker labels, or cache identity.
- Toolchains are canonical domain values, not caller-generated Dockerfiles or command fragments.
- Objects crossing the Interface are immutable.

Invalid plans return a validation error before Docker, temporary-file, tag, or lock side effects.

### Build execution contract

1. Validate the complete plan.
2. For an active Base, require its derived tag to resolve to the locked exact image ID. Never repair it.
3. For a new Base candidate, use the current Base artifact recipe to render its owned template and disposable context, build without assigning the stable tag, verify the recipe contract, obtain the content-addressed image ID, then assign its derived stable tag. A newer packaged Base recipe is never applied to an active Base outside explicit Base update.
4. Produce the complete prepared Platform snapshot containing that Base image ID.
5. Canonicalize each selected Toolchain with the complete exact entries it selects, the current Workspace recipe version, and each selected Runtime's current recipe version; compute fingerprint schema version 1, deduplicate equal fingerprints, and sort unique candidates by fingerprint. Exclude the Base recipe version and every unselected Runtime recipe.
6. Process at most one Workspace candidate at a time. For each candidate, acquire its exclusive fingerprint lease, recheck the stable tag, and either reuse the verified image or render the versioned Workspace template, build, verify, and publish the stable tag.
7. Return one result for every request key, including duplicate semantic requests that shared one build.

Build's injected packaged Recipe catalog exposes exactly four monotonically versioned artifact recipes: Base, Node Runtime, PHP Runtime, and Workspace assembly. Each recipe owns its checked-in Dockerfile templates, disposable-context layout, controlled arguments, assembly steps, and verification contract; the Node recipe also owns package-manager installation, while the PHP recipe owns extension build and enablement. tsdown copies those assets unchanged. Callers never supply recipe files or versions. A template, context, build-flow, or verifier change that can alter an artifact or its contract increments only the owning recipe; implementation-only and byte-identical packaging changes do not.

The DockerProcess production adapter invokes `docker buildx` with argv, streams native output, preserves exit status, uses terminal-aware progress in an interactive terminal and plain progress otherwise, and accepts AbortSignal. It does not use a Docker Engine client.

`prepare` succeeds only when every requested artifact is ready. On the first error or cancellation it schedules nothing further and returns no partial-success value. Verified tags already published remain safe and discoverable by a later recheck; active locks and retained Compose remain the caller's unchanged state unless the caller had already committed a separate earlier stage.

Disposable contexts use a securely created OS temporary directory, contain no credentials, and are removed after success, failure, or cancellation on a best-effort basis. Their existence has no readiness meaning.

## Sync module interface

```ts
interface Sync {
  synchronize(input: {
    project: RegisteredProject
    lease: ProjectLockLease
    signal: AbortSignal
  }): Promise<Result<SynchronizedProject>>
}

interface SynchronizedProject {
  readonly project: RegisteredProject
  readonly composePath: string
  readonly workspaceTag: string
  readonly changed: {
    readonly localConfiguration: boolean
    readonly platformLock: boolean
    readonly compose: boolean
  }
}
```

### Sync preconditions

- The Project root still exists and exactly matches the registered identity.
- The lease belongs to that Project, includes the shared user-scope lifecycle lock and exclusive Project lock, and has not been released.
- No protected Project, Local, Platform, Docker, or Compose state was trusted before lock acquisition.

A failed precondition returns validation or operational failure before writes or Build calls.

### Sync execution contract

1. Reread and validate Project configuration, Local configuration, registration, and active Platform lock under the lease.
2. Materialize current Project-fixed values into Local configuration. If the canonical content changed, atomically write `config.yaml` now. This committed user-scope truth is not rolled back by later failures.
3. Form the Resolved configuration.
4. Use the active Platform snapshot when it contains every required entry. Otherwise acquire the Platform mutation lease, reread the active lock, and resolve only entries still missing into one in-memory candidate. Never refresh existing locked entries.
5. Call `Build.prepare` with that one snapshot, one Workspace request keyed by the Project identity, and the same AbortSignal.
6. If Build prepared a candidate snapshot, atomically activate it while the Platform mutation lease remains held. If activation fails, keep the prior active lock; verified tags remain safe cleanup or retry inputs.
7. Deterministically render the desired Sandbox-only Compose definition from the Resolved configuration and returned Workspace tag. Atomically replace retained `compose.yaml` only when bytes differ.
8. Return `SynchronizedProject`. Do not inspect, start, stop, recreate, or mutate a Sandbox container.

A Compose failure after successful candidate activation never rolls back the valid Platform lock or tags. A retry reuses them and attempts only the remaining Compose publication. A complete no-op returns success with every `changed` field false.

The explicit `sync` operation presents this result and releases its Project lease. `up` uses the same returned Compose path and Workspace tag while retaining the lease through Sandbox inspection and lifecycle work; it does not reread or reconstruct Sync stages.

## Required internal adapters

Production and test adapters exist only at behavior that actually varies:

- HostOperations: `devbox-host` child versus fake leases.
- DockerProcess: direct `docker buildx`／`docker compose` child processes versus a recording fake.
- PlatformResolver: upstream resolution versus deterministic fixtures.
- Configuration, Platform, and Compose repositories: real atomic filesystem storage versus isolated temporary storage.
- Recipe catalog: packaged immutable assets versus fixture assets used by Docker integration tests.

Build and Sync receive these dependencies when constructed. They do not instantiate production adapters internally. No adapter or repository is exported as a public package interface.

## Executable acceptance specification

### Layer 1: Vitest module contracts

All tests use observable Interface results and fake or temporary adapters.

Build must prove:

- malformed or incomplete plans cause no side effects;
- active Base tag absence or image-ID mismatch returns the `update --base` action;
- candidate Base verification failure publishes no Base stable tag;
- equal Workspace semantic inputs build once and return every request key;
- request-key changes do not change fingerprints;
- fingerprint-input changes do change fingerprints;
- changing the Workspace recipe changes every Workspace fingerprint;
- changing one Runtime recipe changes only fingerprints that select that Runtime;
- changing an unselected Runtime recipe or the packaged Base recipe alone does not change a Workspace fingerprint;
- a stable matching tag is reused only after recheck under its fingerprint lease;
- Workspace verification failure publishes no stable tag and stops later scheduling;
- failure after an earlier verified publication preserves that tag but returns overall failure;
- candidate ordering is Base first and then fingerprint order, with one Docker child at a time;
- cancellation stops later work and follows the ten-second escalation contract.

Sync must prove:

- mismatched or released ProjectLockLease fails before reads with side effects;
- protected state is reread after acquisition;
- synchronized fixed configuration commits before later artifact work;
- active Platform entries are never refreshed by Sync;
- missing entries are resolved again after the Platform mutation lease is acquired;
- Build failure retains the prior Platform lock and Compose;
- candidate activation failure retains prior lock and Compose while preserving verified tags;
- Compose failure after activation retains the new valid Platform lock;
- successful Compose publication occurs last;
- repeated synchronization is a successful byte-for-byte no-op;
- `up` consumes `SynchronizedProject` without invoking a second Sync or rereading Compose inputs.

### Layer 2: focused adapter integration

Docker fixture integration uses tiny local, deterministic templates rather than upstream Devbox recipes. It must exercise real `docker buildx`, image inspection, verification-before-tag behavior, stable-tag reuse, mismatched-tag rejection, disposable-context cleanup, retained Compose rendering, and cancellation cleanup without network access.

Go helper integration runs the real `devbox-host` binary and proves:

- shared holders coexist;
- an exclusive holder waits for every shared holder;
- multiple requested locks use canonical rank order;
- malformed or wrong-version JSON produces a structured error and no held lock;
- explicit release, stdin EOF, parent crash, and helper termination release every fd;
- cancellation while waiting acquires nothing and changes no protected state.

### Layer 3: WSL2 release smoke

On the supported WSL2 `linux/amd64` release environment, run one command that exercises the packaged TypeScript CLI, packaged Go helper, production Docker adapter, real Built-in templates, and retained user-scope files. It must:

1. synchronize a fresh combined PHP＋Node Project without starting a Sandbox;
2. materialize or reuse the locked Base, prepare and verify the combined Workspace, activate the first Platform lock, and write Compose last;
3. rerun as a complete no-op with identical active-lock and Compose bytes;
4. confirm the retained Workspace tag resolves to the verified image and the generated Compose references that tag;
5. clean all smoke-test registrations, tags, containers, networks, volumes, locks, and temporary state without touching ordinary user data.

This release smoke establishes only the exercised WSL2 `linux/amd64` behavior.

## Repository layout for implementation

```text
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
packages/
  devbox/
    package.json
    src/
      cli/
      operations/
      modules/
        build/
        sync/
      adapters/
      domain/
    recipes/
    test/
  devbox-linux-x64/
    package.json
    bin/devbox-host
native/
  devbox-host/
    go.mod
    cmd/devbox-host/
    internal/lock/
    internal/protocol/
```

The root pnpm workspace owns development scripts and the single `pnpm-lock.yaml`; its `packageManager` field pins the exact development pnpm release. `packages/devbox` uses Node `>=22`, ESM TypeScript, tsdown, Vitest, Oxlint, and Oxfmt. `native/devbox-host` builds with CGO disabled for `linux/amd64`; a helper release copies that output into the independently versioned platform package, and installation through `npm install -g @ycs77/devbox` never compiles it locally.
