# Node/npm Internal Platform Binary Distribution, Resolution, and Startup

> Research date: 2026-08-03. Scope covers Node.js 22 and npm 11 package semantics, along with first-party implementation/publishing metadata for esbuild 0.28.1, Rollup 4.52.4, and SWC 1.15.47. This document is not a Devbox production implementation, nor does it address native addon compilation.

This document uses "**Source fact**" to mark observations directly supported by documentation or first-party source code, and "**Devbox recommendation**" to mark judgments based on current constraints (`@ycs77/devbox`, ESM, Node >=22, v1 WSL2 linux/amd64 only, internal `devbox-host`). Recommendations are provided for Lucas's decision-making and do not substitute for a final ADR.

> **Subsequent decision override:** The primary-source facts and package-resolution comparisons in this document remain valid, but ADR-0025 has overridden this document's same-version, pre-spawn access check, and standalone hello recommendations. The canonical contract is that the CLI and helper each use SemVer, the main package depends on a compatible helper `1.x` caret range, no additional access precheck is performed, and the first real `acquire` exchange validates the machine protocol. All implementation and publishing decisions shall follow ADR-0025.

## Summary of Conclusions

**Devbox recommendation:** For v1, place `@ycs77/devbox-linux-x64` in `@ycs77/devbox`'s **regular `dependencies`** using the exact same version; constrain both packages with `os: ["linux"]`, `cpu: ["x64"]`. The platform package should include `bin/devbox-host` via `files`, **not declare `bin`**; use explicit package subpath `exports` to expose the asset and package metadata, and have the main package resolve the URL with `import.meta.resolve()` and convert to a local path with `fileURLToPath()`.

This recommendation follows the same core pattern used by esbuild/Rollup/SWC — "main package + exact-version platform packages" — but intentionally avoids copying their `optionalDependencies`: mature projects list many mutually exclusive platform packages and must allow npm to skip incompatible ones. Devbox v1 has only one required helper; if it were an optional dependency, users could use `--omit=optional` to legitimately obtain an installation that succeeds but does not work. npm's formal semantics for optional dependencies are precisely "if the dependency cannot be found or fails to install, npm will proceed; the program is responsible for handling the absence" [npm `optionalDependencies`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#optionaldependencies).

The Runtime should still be responsible, in order, for:

1. Reporting an unsupported runtime (especially WSL2; `os`/`cpu` can only identify `linux`/`x64`, not WSL2).
2. Resolving the platform package manifest and verifying it is the exact same version as the CLI.
3. Resolving the helper asset, verifying it is a regular file and executable by the current user; actual spawn errors remain the final arbiter.
4. Performing a machine-protocol handshake at startup, at minimum comparing `protocolVersion` and helper/package version, and setting timeout and frame/input limits.
5. v1 need not recompute the binary hash on every launch by default; npm's artifact integrity already handles download/cache content consistency, but if the threat model includes post-install tampering, then add a check where the main package holds the expected hash.

## 1. Formal Semantics of npm `package.json` Fields

| Field | Source fact | Implication for internal binaries |
| --- | --- | --- |
| `bin` | npm maps command names to files within the package; globally installed, they are linked into the global bin; as a dependency, they are linked to a location discoverable by `npm exec` or `npm run`. On Unix-like systems this is a symlink; on Windows, a command shim. [npm `bin`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#bin) | It is a **public command discovery mechanism**, not an API for "getting the path to an internal asset." If the platform package declares `devbox-host` as `bin`, the helper ends up in the consumer's command space. |
| `files` | `files` is a packaging allow-list; omitted, it defaults to `['*']`. `package.json`, README, LICENSE, and files referenced by `main` and `bin` are always included in the tarball; certain VCS/lock files are always excluded. [npm `files`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#files) | An internal binary does not need `bin` to be published; listing it explicitly in `files` is sufficient, and releases should verify the files and modes in the tarball. |
| `os` | An allow-list (e.g. `['darwin','linux']`) or a deny-list prefixed with `!`; the host OS is determined by `process.platform`. [npm `os`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#os) | The platform package should declare `['linux']` to prevent npm from considering it applicable to other OSes. It does not express distro or WSL2. |
| `cpu` | Same allow/deny semantics as `os`; host architecture is determined by `process.arch`. [npm `cpu`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#cpu) | linux/amd64 in npm/Node is `x64`, so it should be declared as `['x64']`. |
| `dependencies` | Names mapped to version ranges; a single `version` specifier means an exact match is required. [npm `dependencies`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#dependencies) | For Devbox v1's required helper, an exact normal dependency makes absence an install failure rather than a deferred runtime error. |
| `optionalDependencies` | npm can still succeed if the dependency cannot be found or fails to install; `npm install --omit=optional` will skip them entirely; the program must handle absence itself. An optional entry with the same name overrides a `dependencies` entry. [npm `optionalDependencies`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#optionaldependencies) | Suitable for "publishing many mutually exclusive platform packages simultaneously" or truly degradable features; it does not mean "required only when `os`/`cpu` matches." |

**Source fact:** npm's `os`/`cpu` are install-time compatibility metadata, not runtime feature probes; they are drawn from `process.platform` and `process.arch` respectively. Thus WSL2, a generic Linux VM, and a physical Linux host may all present identically as `linux`/`x64`. [npm `os`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#os), [npm `cpu`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#cpu)

**Devbox recommendation:** v1 should place `os: ["linux"]`, `cpu: ["x64"]` in both the main package and the platform package; the former lets `@ycs77/devbox` honestly declare its support surface, and the latter prevents loss of constraints if the platform package is installed directly. WSL2 detection is reserved for the CLI runtime preflight. If a single main package later supports multiple platforms, switch to the mature exact `optionalDependencies` list pattern and turn "optional was omitted" into a clear, actionable runtime error.

## 2. Node Package `exports` and Resolution

### 2.1 `exports` Is a Package Contract, Not an npm Packaging Manifest

**Source fact:** `exports` applies to both ESM and CommonJS, can define multiple package entry points, and encapsulates unlisted subpaths; once defined, an unexported `pkg/subpath` yields `ERR_PACKAGE_PATH_NOT_EXPORTED`. It is not a filesystem sandbox: a known absolute path can still access files directly. [Node package entry points](https://nodejs.org/docs/latest-v22.x/api/packages.html#package-entry-points), [Node subpath exports](https://nodejs.org/docs/latest-v22.x/api/packages.html#subpath-exports)

**Source fact:** Export targets must be relative URLs beginning with `./` and staying within the package. [Node export target rules](https://nodejs.org/docs/latest-v22.x/api/packages.html#targets-must-be-relative-urls) npm's `files` determines what goes into the tarball; Node's `exports` determines what package specifiers can resolve to — distinct responsibilities. [npm `files`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#files), [Node `exports`](https://nodejs.org/docs/latest-v22.x/api/packages.html#exports)

Thus a binary asset can simultaneously:

- Be included by `files`;
- Not appear in `bin`, so there is no `.bin` symlink / public command;
- Be provided as a stable package subpath resolution contract via `exports["./devbox-host"]`.

Here "export" means the Node package subpath is resolvable by importers, **not** a shell command. If "internal" further requires that other JS consumers should not see the binary subpath, see the JS resolver module approach below.

### 2.2 `import.meta.resolve()`

**Source fact:** Node 22's `import.meta.resolve(specifier)` synchronously returns an absolute URL string relative to the current module, supports all features of Node module resolution, and is subject to package `exports` constraints. Node's official examples directly resolve non-JS assets: `import.meta.resolve('component-lib/asset.css')`. [Node `import.meta.resolve`](https://nodejs.org/docs/latest-v22.x/api/esm.html#importmetaresolvespecifier)

**Important limitation (source fact):** For `file:` URLs pointing to non-existent files, `import.meta.resolve()` no longer guarantees throwing an error; it only answers "what URL would this specifier resolve to." It may also perform synchronous filesystem operations. [History and caveats for the same API](https://nodejs.org/docs/latest-v22.x/api/esm.html#importmetaresolvespecifier)

**Devbox recommendation:** For ESM, Node >=22 `@ycs77/devbox`, using `import.meta.resolve()` directly is the most natural approach; after obtaining the URL, use `fileURLToPath()` and then perform actual filesystem/spawn checks. Do not mistake "resolve succeeded" for "binary exists and is executable."

### 2.3 `require.resolve()`

**Source fact:** `require.resolve(request)` uses the CommonJS `require()` resolution machinery, only returns the resolved filename without loading the module; throws `MODULE_NOT_FOUND` when not found. [Node `require.resolve`](https://nodejs.org/docs/latest-v22.x/api/modules.html#requireresolverequest-options) Package `exports` applies equally to CommonJS and ESM. [Node package entry points](https://nodejs.org/docs/latest-v22.x/api/packages.html#package-entry-points)

**Devbox recommendation:** CommonJS packages or existing CJS loaders can use `require.resolve()`; Devbox is ESM and does not need `createRequire()` for binary resolution unless compatibility with a third-party package that only provides a CJS resolver is required. Using `import.meta.resolve()` directly avoids an extra module-system adapter.

## 3. First-Party Implementations in Mature Projects

### 3.1 esbuild 0.28.1: Binary Asset Subpath + `require.resolve`

**Source fact:** esbuild's main package lists all `@esbuild/<os>-<arch>` packages as **exact `optionalDependencies`**, and the main package itself has a public `esbuild` `bin`. For example, `@esbuild/linux-x64: "0.28.1"`. [esbuild main package metadata](https://github.com/evanw/esbuild/blob/v0.28.1/npm/esbuild/package.json)

**Source fact:** `@esbuild/linux-x64` is the same version as the main package, with metadata constraining `os: ['linux']`, `cpu: ['x64']`; the binary is located at `bin/esbuild`. [esbuild linux-x64 metadata](https://github.com/evanw/esbuild/blob/v0.28.1/npm/%40esbuild/linux-x64/package.json)

**Source fact:** At runtime, it maps `process.platform`, `os.arch()`, and endianness to a package name and subpath, then uses `require.resolve(`${pkg}/${subpath}`)` to obtain the binary path. On absence, it distinguishes between optional dependency omitted, installed for the wrong platform, or fallback download, and produces a specific recovery message; the code also explicitly states that platform packages should be installed alongside the main package via optional dependencies. [esbuild `node-platform.ts`](https://github.com/evanw/esbuild/blob/v0.28.1/lib/npm/node-platform.ts)

**Source fact:** esbuild, after starting the service, treats the first packet as the binary version and immediately rejects it if it differs from the JS-side `ESBUILD_VERSION`; this is runtime protocol alignment beyond distribution versioning. [esbuild version handshake](https://github.com/evanw/esbuild/blob/v0.28.1/lib/shared/common.ts#L617-L630)

**Observation:** esbuild's platform package does not declare `bin`; the public `esbuild` command belongs to the main package, and the main package internally resolves the real binary. This directly supports the idea that "the helper asset does not need to be a public command." Its path resolution relies on package subpaths, but that version does not use `exports` to encapsulate the binary subpath.

### 3.2 Rollup 4.52.4: JS Resolver Module + Package Root Load

**Source fact:** The published Rollup main package lists `@rollup/rollup-<platform>-<arch>-<abi>` packages as exact `optionalDependencies`, e.g. `@rollup/rollup-linux-x64-gnu: "4.52.4"`. [Rollup 4.52.4 registry metadata](https://registry.npmjs.org/rollup/4.52.4)

**Source fact:** The linux-x64-gnu package is the same version, constrained with `os: ['linux']`, `cpu: ['x64']`, `libc: ['glibc']`, and uses `main` to point to a `.node` binding. [Rollup linux-x64-gnu metadata](https://registry.npmjs.org/%40rollup%2frollup-linux-x64-gnu/4.52.4)

**Source fact:** Rollup's `native.js` is a resolver/loader: based on `process.platform`, `process.arch`, and musl detection, it selects a package suffix, preferring to load a local binding from the same package and otherwise `require('@rollup/rollup-' + packageBase)`; unsupported combinations and missing optional packages are both converted into targeted errors. [Rollup `native.js`](https://github.com/rollup/rollup/blob/v4.52.4/native.js)

**Observation:** Rollup does not construct `node_modules` paths itself; it places platform detection in a JS resolver and then lets Node resolve the package root. This suits cases requiring ABI/musl dispatch and loading `.node` addons, but Devbox v1 has only a single executable asset — copying the full resolver table would be deeper than the necessary interface.

### 3.3 SWC 1.15.47: Generated JS Loader + Errors Aggregation

**Source fact:** `@swc/core`'s published metadata also lists optional platform packages at the same exact version as the main package, e.g. `@swc/core-linux-x64-gnu: "1.15.47"`. [SWC core registry metadata](https://registry.npmjs.org/%40swc%2fcore/1.15.47) That platform package is constrained to `linux`/`x64`/glibc, with `main` pointing to a native binding. [SWC linux-x64-gnu metadata](https://registry.npmjs.org/%40swc%2fcore-linux-x64-gnu/1.15.47)

**Source fact:** The generated `binding.js` selects a binding based on OS, arch, and musl, first trying the local `.node` and then `require()`-ing the platform package; it collects all load errors, can ultimately fall back to WASI, and reports failures with causes if that also fails. [SWC `binding.js`](https://github.com/swc-project/swc/blob/v1.15.47/packages/core/binding.js)

**Observation:** The commonalities across all three projects are exact-version platform packages, platform metadata, and the Node resolver — not assuming a hoisted `node_modules/<name>` path. esbuild additionally demonstrates a runtime version handshake for the executable machine protocol; Rollup/SWC are in-process addons without the same subprocess protocol boundary.

## 4. Comparison of Four Resolution Approaches

| Approach | Advantages | Costs / Risks | Applicability to Devbox |
| --- | --- | --- | --- |
| Public `bin` symlink | npm automatically creates a PATH command; convenient for global, `npm exec`, and `npm run`. [npm `bin`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#bin) | The helper name enters the consumer's command space; the `.bin` location is a package-manager installation detail; if the main program also searches PATH, it could execute a different version. | **Not recommended.** `@ycs77/devbox` may have a public `devbox` bin, but the platform package should not have a `devbox-host` bin. |
| Package export + `import.meta.resolve` / `require.resolve` | Uses official Node package resolution; physical files can be moved while the specifier remains unchanged; `exports` provides an explicit allow-list; the official API explicitly supports resolving assets. [Node `import.meta.resolve`](https://nodejs.org/docs/latest-v22.x/api/esm.html#importmetaresolvespecifier) | The asset subpath is part of the package's programmatic contract; resolve does not guarantee the target exists; URL-to-path conversion must be handled. | **Preferred.** ESM/Node 22 fits naturally; minimal interface. |
| JS resolver module | Can hide the binary's actual name, exporting only `binaryUrl` / `resolveBinary()`; can centralize platform, ABI, fallback, and user-friendly errors. Rollup/SWC adopt this loader layer. [Rollup source](https://github.com/rollup/rollup/blob/v4.52.4/native.js), [SWC source](https://github.com/swc-project/swc/blob/v1.15.47/packages/core/binding.js) | Adds one more JS module to publish, test, and version; if the resolver only returns a fixed sibling URL, it may be a shallow wrapper. | **Viable alternative.** Worth adopting only if Lucas has a strict requirement that "the binary subpath should not become part of the package contract." |
| Manually deriving `node_modules` paths | Superficially zero metadata/API. | Assumes dependency hoisting, directory depth, and physical layout; fragile with nested dependencies, symlinks, pnpm store, or PnP. Node officially states that module lookup follows the caller's real path and the `node_modules` hierarchy, and packages can be placed anywhere. [Node package-manager tips](https://nodejs.org/docs/latest-v22.x/api/modules.html#package-manager-tips) | **Rejected.** Do not construct `../node_modules/@ycs77/...` from the CLI path. |

**Devbox recommendation:** Choose the second option; if a platform/libc matrix emerges in the future, elevate platform selection into a small resolver within the main package. Do not preemptively replicate Rollup/SWC's large dispatch table for a "possible future."

## 5. Suggested Package Contract (Illustrative, Not Production Implementation)

Key metadata for the main package:

```json
{
  "name": "@ycs77/devbox",
  "version": "X.Y.Z",
  "type": "module",
  "engines": { "node": ">=22" },
  "os": ["linux"],
  "cpu": ["x64"],
  "dependencies": {
    "@ycs77/devbox-linux-x64": "X.Y.Z"
  }
}
```

Key metadata for the platform package:

```json
{
  "name": "@ycs77/devbox-linux-x64",
  "version": "X.Y.Z",
  "os": ["linux"],
  "cpu": ["x64"],
  "files": ["bin/devbox-host"],
  "exports": {
    "./devbox-host": "./bin/devbox-host",
    "./package.json": "./package.json"
  }
}
```

The main package's resolution concept can be kept as:

```js
const helperUrl = import.meta.resolve(
  '@ycs77/devbox-linux-x64/devbox-host',
);
const platformManifestUrl = import.meta.resolve(
  '@ycs77/devbox-linux-x64/package.json',
);
```

The above is only an interface sketch. The key decisions are:

- **No** `@ycs77/devbox-linux-x64.bin`, so npm does not create a `devbox-host` command shim.
- The asset's package specifier is fixed; the physical `bin/devbox-host` can be reorganized in the future without changing callers.
- Exporting `package.json` is a deliberate version-verification contract; Node explicitly states that when `exports` is present, even `package.json` is encapsulated by default and must be explicitly listed to be accessible via package subpath. [Node package entry points](https://nodejs.org/docs/latest-v22.x/api/packages.html#package-entry-points)
- If exporting the manifest is undesirable, a JS resolver can instead export `{ binaryUrl, packageVersion }`; however, `packageVersion` must be single-sourced from release tooling to avoid a manually duplicated version.

## 6. Runtime Verification Responsibilities and npm Integrity Boundaries

### 6.1 Responsibility Matrix

| Check | What npm already provides | What the Runtime must still do | Recommended strength |
| --- | --- | --- | --- |
| package version | Exact dependency requires the resolver to select the same version; the lockfile describes the exact tree. [npm dependencies](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#dependencies), [package-lock description](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json#description) | Read the platform manifest's `version` and compare it with the currently executing CLI version. Root projects can use `overrides` to replace dependencies, and install directories can be manually modified, so an exact spec is not runtime identity proof. [npm `overrides`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#overrides) | **Required.** Errors should list expected/actual/package name. |
| binary existence/type | `files` controls what should be published; integrity covers the unpacked artifact; but the resolution API does not guarantee the target exists. [npm files](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#files), [Node resolve history](https://nodejs.org/docs/latest-v22.x/api/esm.html#importmetaresolvespecifier) | After resolve, `stat` and require a regular file; handle missing package, missing export, and missing file as distinct messages. | **Required.** |
| executable permission | npm metadata's `files`/`exports` do not declare that the runtime user necessarily has execute permission. | On Linux, `fsPromises.access(path, X_OK)` can be used for diagnosis; `X_OK` means the calling process can execute. [Node file access constants](https://nodejs.org/docs/latest-v22.x/api/fs.html#file-access-constants) | **Should do.** But preflight has TOCTOU, and the actual spawn error is authoritative; Node also warns of access-then-use races. [Node `fsPromises.access`](https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisesaccesspath-mode) |
| binary hash | The lockfile's `integrity` is the SRI (sha512/sha1) of the artifact unpacked to that location; npm cache performs full integrity verification on insertion/extraction. [package-lock `integrity`](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json#packages), [npm cache integrity](https://docs.npmjs.com/cli/v11/commands/npm-cache#details) | Only when detecting post-install corruption/tampering, or when an independent binary identity separate from the registry tarball is needed, should the **main package** hold the expected SHA-256 and compute it before launch. | **Not default for v1.** See threat boundary below. |
| machine protocol | npm/package version does not know what protocol the executable will actually speak. | After starting the helper, exchange a versioned hello; validate `protocolVersion`, helper version, frame format; set handshake timeout / max frame; fail closed on mismatch. | **Required.** esbuild's first-packet version check is a direct precedent. [esbuild handshake](https://github.com/evanw/esbuild/blob/v0.28.1/lib/shared/common.ts#L617-L630) |
| process launch/result | npm does not execute the helper. | Use the absolute resolved path to spawn directly, without shell/PATH; listen for spawn `error`, exit/close, signal; constrain stdout/stderr or consume continuously. Node's `error` event covers failure to spawn the process. [Node child process `error`](https://nodejs.org/docs/latest-v22.x/api/child_process.html#event-error) | **Required.** |

### 6.2 What npm Integrity Guarantees and Does Not Guarantee

**Source fact:** `package-lock.json`'s `integrity` is the SRI of the actual unpacked artifact; npm's content-addressable cache verifies integrity on insertion and extraction, and if the cache returns data, it is guaranteed to match what was originally inserted. [npm package-lock format](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json#packages), [npm cache design](https://docs.npmjs.com/cli/v11/commands/npm-cache#a-note-about-the-caches-design)

This covers **download artifact content consistency**, not the following:

- Whether the package publisher is trustworthy or the binary source code is safe; registry signatures are a separate mechanism verifiable with `npm audit signatures`. [npm registry signatures](https://docs.npmjs.com/verifying-registry-signatures)
- Whether the binary is suitable for the current WSL2/kernel/libc/CPU features; `os`/`cpu` only look at two strings from Node.
- Post-install file modification by a privileged local actor. npm's own recorded hidden lockfile may not detect changes if only package contents are altered (directory mtime may be unchanged). [npm hidden lockfiles](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json#hidden-lockfiles)
- Whether the executable bit is set, whether the mount is `noexec`, or whether the dynamic linker / shared libraries are available.
- Whether `devbox-host`'s machine protocol, behavior, exit semantics, or output is correct.

**Devbox recommendation:** Do not treat per-runtime SHA-256 as a necessary redo of npm integrity. If the concern is only download corruption, it is redundant cost; if the concern is a mis-matched platform package or a partially corrupted install, same-version manifest + protocol handshake can detect most practical problems with more direct errors. Only if Lucas explicitly places "post-install binary bytes must be immutable" in the threat model should the main package hold a per-version expected hash; a hash placed in the same package as the binary, writable with the same privileges, has no independent trust value against an active attacker.

### 6.3 Recommended Startup Verification Sequence

1. Verify Node runtime and WSL2 conditions; errors should state that WSL2 linux/x64 is supported, not just print `unsupported platform`.
2. Resolve the exported platform manifest, parse and compare package name/version.
3. Resolve the binary asset, convert to path, `stat` as regular file; use `X_OK` for a useful preflight diagnosis.
4. Spawn directly with the absolute path (no shell, no PATH search), listening for spawn errors. A race exists between preflight and spawn, so spawn failure must still be fully handled. [Node child process](https://nodejs.org/docs/latest-v22.x/api/child_process.html), [Node access caveat](https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisesaccesspath-mode)
5. Complete the machine hello before accepting any normal response; at minimum include `protocolVersion` and `helperVersion`. Version mismatch, malformed frames, premature EOF, or timeout should all terminate the helper and return an actionable error.
6. Thereafter, maintain request id, frame size, timeout, exit code, and stderr boundaries for each request/response; package version check cannot substitute for protocol validation.

## 7. Publishing and Absence Handling

**Devbox recommendation:** The release pipeline (not the runtime) should gate the two tarballs for the same version on:

- The main manifest's exact dependency string equals the main version; the platform manifest version is also identical;
- The platform tarball contains only the expected metadata/license and `bin/devbox-host`, with no unexpected `bin` field;
- After unpacking, the file is in the expected linux/x86-64 format and retains the executable mode;
- In a clean WSL2 linux/x64 install environment, run a real resolve → spawn → handshake smoke test using the **installed main CLI**; do not just directly execute build output;
- Simulate and confirm error messages: platform package missing, binary missing/not executable, package version mismatch, protocol mismatch.

If optional platform packages are used in the future, the missing error should, like esbuild, clearly state the package name and recovery steps (e.g., do not use `--omit=optional` and reinstall on the target platform), rather than exposing the raw `MODULE_NOT_FOUND` to users. [esbuild missing-package handling](https://github.com/evanw/esbuild/blob/v0.28.1/lib/npm/node-platform.ts)

## 8. Open Questions (Requiring Lucas's Final Decision)

1. **Boundary of "internal":** Is the requirement only that it not appear on the shell PATH, or should other JS consumers also be unable to resolve the binary subpath? The former suggests direct asset export; the latter suggests a JS resolver module that only exports `resolveBinary()`.
2. **v1 install policy:** Is it acceptable to install on non-WSL Linux x64 and only reject at runtime? npm metadata cannot express WSL2; if unacceptable, detection still can only be done at runtime/preinstall, and a preinstall script adds installation side effects. This document recommends runtime fail-fast and does not recommend an install script that downloads or patches binaries.
3. **libc/build baseline:** Is `@ycs77/devbox-linux-x64` statically linked, or does it require a minimum glibc version? Rollup/SWC encode GNU/musl into the package identity and `libc` metadata; if Devbox has dynamic dependencies, the compatibility policy should be fixed before deciding whether the package needs renaming.
4. **Hash threat model:** Is the goal to guard against accidental post-install corruption, or against an adversary with local write access? The latter requires a stronger trust root such as independent signatures / read-only installation, not a hash inside the same package.
5. **Protocol compatibility:** Must the package version be exact, and must the protocol version also be exact; or is a helper with the same protocol major acceptable? For v1, exact package version + exact protocol version is the easiest way to fail closed; relax later based on actual compatibility needs.
6. **Future platform expansion:** If darwin/windows/musl are added, should the approach shift to exact optional dependencies + resolver table, or publish platform-specific entry packages? This would change the current "required single dependency" recommendation and should be decided separately.

## Final Recommendation (For Decision)

Under the currently known constraints, the minimal and most reliable approach is:

- `@ycs77/devbox` has a required exact dependency on `@ycs77/devbox-linux-x64`;
- The platform package uses `os`/`cpu` constraints, includes the binary via `files`, and does not use `bin`;
- Package `exports` explicitly lists `./devbox-host` and `./package.json`;
- The ESM main CLI resolves both using `import.meta.resolve()`, without deriving `node_modules` paths;
- The runtime performs same-version, regular-file/X_OK, spawn error, and versioned machine handshake checks;
- npm integrity serves as the baseline for artifact content consistency; v1 does not re-hash on every launch unless Lucas selects a stronger post-install tamper threat model;
- The release process gates on an end-to-end handshake smoke test after installation in a clean WSL2 environment.

This preserves a clear evolution path toward a JS resolver / optional multi-platform packages in the future, while not introducing a public helper command, an install-time downloader, or assumptions about `node_modules` layout in v1.
