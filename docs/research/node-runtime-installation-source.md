# Node Runtime Installation Source: Official Image vs. Official Tarball

> Research date: 2026-08-10. Scope is Debian 13 Trixie Slim, `linux/amd64` and `linux/arm64`, one generated multi-stage Workspace Dockerfile, exact Platform-lock inputs, and release-line-isolated Runtime paths. This is research, not an implementation.
>
> **Terminology:** “Source fact” is directly supported by a first-party Node.js, `nodejs/docker-node`, or Docker source. “Devbox recommendation” is an architectural judgment derived from those facts. No claim below treats a mutable tag or a release-line alias as an exact artifact.

> Decision update: ADR-0036 chose direct installation from the official Node binary tarball through a family-owned Runtime recipe. The source-image recommendation below records the pre-decision comparison and is no longer the active architecture.

## Decision summary

**Devbox recommendation:** For the current architecture, retain a **digest-pinned official `node:<exact-version>-trixie-slim` source stage**, then construct a deliberately normalized Node Runtime tree at `/opt/devbox/runtimes/node/<release-line>` in the same generated Dockerfile. This is the smallest change compatible with the current Platform-lock contract, which already records a Node Runtime `revision`, source `image`, and immutable image `digest`, and with ADR-0035’s single inline Workspace build pipeline.

This recommendation is **not** “blindly copy `/usr/local` and call it complete.” The official image itself installs the official Node binary tarball into `/usr/local`, but also adds image-specific files and, through Node 25, puts Yarn under `/opt`. Its executable shared-library packages remain in the source image’s Debian filesystem and do not accompany a `/usr/local` copy. Devbox therefore must:

1. treat the Base profile’s exact native-package plan as the owner of Runtime shared libraries;
2. copy/preserve the tar-origin Node tree, including relative npm/Corepack symlinks;
3. omit the image entrypoint and normalize the absolute `nodejs` symlink;
4. not import the image-bundled Yarn as an implicit dependency—install the exact npm/Corepack/pnpm/Yarn entries already required by the Platform lock into the release-line bundle.

Direct tarball installation is technically clean and produces the same upstream Node payload, but it changes the Runtime provenance fields from an OCI image/digest to URL + signed checksum inputs and duplicates download/signature/extraction logic already maintained by `nodejs/docker-node`. It is preferable only if Devbox deliberately revises that lock contract to make Node distribution archives the canonical Runtime artifact.

A concrete path for release line 24 is:

```text
/opt/devbox/runtimes/node/24
├── bin/
├── include/
├── lib/
└── share/
```

The selected project can put `/opt/devbox/runtimes/node/24/bin` first on `PATH`; another release line, for example 22, remains independently rooted at `/opt/devbox/runtimes/node/22`.

## 1. What the official Trixie Slim image actually contains

### 1.1 Node comes from the official precompiled binary tarball

**Source fact:** The current Node 24 Trixie Slim Dockerfile starts from `debian:trixie-slim`, maps Debian `amd64` to Node’s `x64` archive name and Debian `arm64` to `arm64`, downloads `node-v$NODE_VERSION-linux-$ARCH.tar.xz` and `SHASUMS256.txt.asc` from `https://nodejs.org/dist/v$NODE_VERSION/`, verifies the signed checksum manifest, checks the selected archive’s SHA-256, and extracts it into `/usr/local` using `--strip-components=1 --no-same-owner`. It is not rebuilding Node from source. [Official Node 24 Trixie Slim Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)

**Source fact:** Node’s own verification instructions say each release download directory contains `SHASUMS256.txt.asc`, which combines file SHA-256 values with a Node releaser’s PGP signature. Node publishes a maintained trusted keyring and documents `gpgv` followed by checksum verification. [Node README: Verifying binaries](https://github.com/nodejs/node/blob/main/README.md#verifying-binaries), [Node README: Release keys](https://github.com/nodejs/node/blob/main/README.md#release-keys), [official release-key repository](https://github.com/nodejs/release-keys)

**Source fact:** The Docker recipe obtains the listed active releaser keys from `keys.openpgp.org` with an Ubuntu keyserver fallback, decrypts/verifies `SHASUMS256.txt.asc`, and then pipes the one matching archive checksum into `sha256sum -c`. Thus its chain is:

```text
nodejs/docker-node recipe
  -> Node releaser key fingerprints
  -> signed Node SHASUMS256.txt.asc
  -> selected Node binary tarball SHA-256
  -> extracted Node tree
  -> Docker Official Image manifest/layers
```

The source-image approach adds the OCI registry and Docker Official Image publication to the same Node archive chain; it does not substitute a different Node build. [Dockerfile verification commands](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile), [Node binary verification contract](https://github.com/nodejs/node/blob/main/README.md#verifying-binaries)

### 1.2 Files added or changed by `nodejs/docker-node`

**Source fact:** The official Node archive is extracted beneath `/usr/local`. For Node 24, Node’s installer includes `node`, headers, documentation/man pages, npm under `lib/node_modules/npm`, Corepack under `lib/node_modules/corepack`, and relative command symlinks such as `bin/npm -> ../lib/node_modules/npm/bin/npm-cli.js`, `bin/npx -> ../lib/node_modules/npm/bin/npx-cli.js`, and `bin/corepack -> ../lib/node_modules/corepack/dist/corepack.js`. Node’s install source makes npm and Corepack default install components and supports explicit `--without-npm` / `--without-corepack` build choices. [Node 24 installer](https://github.com/nodejs/node/blob/v24.x/tools/install.py), [Node 24 configuration defaults](https://github.com/nodejs/node/blob/v24.x/configure.py)

**Source fact:** Corepack is bundled with Node from 14.19.0 up to, but not including, Node 25; Node 24’s documentation explicitly warns that it will no longer be distributed starting with Node 25. npm remains included in all official Node Docker image variants. [Node 24 Corepack documentation](https://nodejs.org/docs/latest-v24.x/api/corepack.html), [`docker-node` image-variant documentation](https://github.com/nodejs/docker-node#image-variants)

**Source fact:** The Node 24 Trixie Slim image additionally:

- creates group/user `node` with UID/GID 1000 and `/home/node`;
- adds an absolute `/usr/local/bin/nodejs -> /usr/local/bin/node` symlink;
- installs Yarn Classic 1.22.22 at `/opt/yarn-v1.22.22`, with `/usr/local/bin/yarn` and `yarnpkg` pointing into that `/opt` tree;
- copies `docker-entrypoint.sh` into `/usr/local/bin` and sets image `ENTRYPOINT`/`CMD` metadata.

These are Docker-image additions, not evidence that the upstream Node tarball contains Yarn, a `node` account, or the entrypoint. [Node 24 Trixie Slim Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile), [`docker-node` Yarn bundling policy](https://github.com/nodejs/docker-node#yarn-v1-classic-bundling)

**Source fact:** `docker-node` documents Yarn Classic as bundled only for Node 25 and below and absent beginning with Node 26. Therefore “what comes with the official image” changes by release line even when the Debian variant name is the same. [`docker-node` Yarn v1 policy](https://github.com/nodejs/docker-node#yarn-v1-classic-bundling)

### 1.3 OS packages retained by the Slim recipe

**Source fact:** The Trixie Slim recipe temporarily installs `ca-certificates`, `curl`, `wget`, `gnupg`, `dirmngr`, `xz-utils`, and `libatomic1`. It then marks packages automatic, runs `ldd` across executable files under `/usr/local`, maps external library paths back to owning Debian packages, marks those packages manual, and purges auto-removable packages. The Dockerfile therefore intentionally retains only the Debian packages its discovered executables need, rather than all download/build tooling. [Node 24 Trixie Slim Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)

**Unknown:** The recipe does not publish an architecture-independent final dpkg manifest. The exact retained package set depends on the exact Debian base layers, target architecture, and `ldd` results. The immutable OCI manifest fixes the realized image, but the Dockerfile alone is insufficient to enumerate every final package/version. Devbox must not infer that copying `/usr/local` copies those packages.

**Source fact:** Node 24’s official GNU/Linux x64 and arm64 binaries are produced on RHEL 8, are Tier 1, and target glibc >= 2.28 and libstdc++ >= 6.0.25. Debian 13 exceeds those stated baselines. Newer Node release lines can add requirements: Node’s current build documentation says official Linux binaries beginning with Node 25 require a `libatomic` runtime. [Node 24 supported/official binary platforms](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#official-binary-platforms-and-toolchains), [current Node official binary requirements](https://github.com/nodejs/node/blob/main/BUILDING.md#official-binary-platforms-and-toolchains)

**Source fact:** Node is built with its dependencies bundled by default; distributions can instead opt into shared dependencies, in which case they are responsible for runtime compatibility. This reduces—but does not eliminate—the need for final-stage system libraries, as the official Linux executable still has platform runtime requirements such as glibc/libstdc++ and, for Node 25+, libatomic. [Node build documentation: shared dependencies](https://github.com/nodejs/node/blob/main/BUILDING.md#building-to-use-shared-dependencies-at-runtime)

## 2. Platform and architecture resolution

**Source fact:** The Node distribution index is a machine-readable list of exact releases. Each record includes the exact version, date, available file families, npm version, V8/OpenSSL versions, native module ABI number (`modules`), LTS value, and security-release flag. Current supported releases expose both `linux-x64` and `linux-arm64` artifacts. [Node distribution index JSON](https://nodejs.org/dist/index.json), [Node release directory](https://nodejs.org/download/release/)

**Source fact:** Node’s release policy defines a release line separately from an exact revision. As of the research date, 22.x is Maintenance LTS, 24.x is Active LTS, and 26.x is Current; exact patch releases continue within those lines. [Node Release Working Group schedule](https://github.com/nodejs/Release#release-schedule)

**Source fact:** The official `docker-node` Trixie Slim recipe maps the build stage’s Debian architecture to the matching Node archive. Its supported cases include `amd64 -> x64` and `arm64 -> arm64`. `docker-node` states that its supported OS/architecture combinations are recorded in `versions.json`. [Trixie Slim architecture switch](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile), [`docker-node` supported architectures](https://github.com/nodejs/docker-node#supported-architectures), [`versions.json`](https://github.com/nodejs/docker-node/blob/main/versions.json)

**Source fact:** Docker multi-platform images use an OCI manifest list/index pointing to distinct platform manifests and layers. On pull, Docker automatically chooses the matching host platform. [Docker multi-platform image structure](https://docs.docker.com/build/building/multi-platform/#difference-between-single-platform-and-multi-platform-images)

**Observed official registry example (2026-08-10):** `node:24.19.0-trixie-slim` is an OCI image index with digest `sha256:0711b541c1c33a8a530ac4f0d391baa9a15b3d804695b1b24a47daa5fb60e74d`; its `linux/amd64` child is `sha256:f2925910482dc53394bc0034c5f4abffcd01de400794c050ca343fe0d733b486`, while `linux/arm64/v8` is `sha256:8525258f39fa3365fcf9a9d01e85458c7280ad00bd30c5e67655311262257e9e`. [Docker Hub official tag API](https://hub.docker.com/v2/repositories/library/node/tags/24.19.0-trixie-slim)

**Implication:** A lock shared across amd64/arm64 may record the immutable **index digest** plus the intended target platform and, if byte-exact per-platform provenance is required, the resolved child-manifest digest. Recording only a child digest cannot describe both architectures. A direct-tar lock instead needs one signed SHA-256 per Node archive architecture.

## 3. Source-image relocation versus direct tarball installation

| Concern | Digest-pinned official source image | Direct official Node tarball |
| --- | --- | --- |
| Upstream Node bytes | The recipe downloads the official `linux-$ARCH.tar.xz`, verifies Node’s signed checksum file, then extracts it. [Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile) | Build downloads the same official archive and must itself verify `SHASUMS256.txt.asc` and the selected SHA-256. [Node verification](https://github.com/nodejs/node/blob/main/README.md#verifying-binaries) |
| Additional trust/publication boundary | Node release + `nodejs/docker-node` recipe + Docker Official Image registry/manifest. A digest fixes the published image. Docker says tags are mutable but a digest selects the same image. [Docker digest pinning](https://docs.docker.com/build/building/best-practices/#pin-base-image-versions) | Node release directory + Node release-key trust. No OCI publication step, but Devbox owns correct keyring/signature/checksum implementation. [Node release keys](https://github.com/nodejs/node/blob/main/README.md#release-keys) |
| amd64/arm64 | One immutable OCI index can select the correct child manifest automatically; target platform still must be explicit. [Docker multi-platform docs](https://docs.docker.com/build/building/multi-platform/) | Resolver maps `linux/amd64 -> linux-x64` and `linux/arm64 -> linux-arm64`; each archive has a distinct SHA-256 in the signed manifest. [Node index](https://nodejs.org/dist/index.json) |
| Isolation path | Official files begin under `/usr/local`; relocating requires handling image-added absolute symlinks and excluding image-only content. | Extract once with `--strip-components=1` directly into `/opt/devbox/runtimes/node/<line>`; tar-origin npm/Corepack links are relative and remain within the relocated tree. [Node installer layout](https://github.com/nodejs/node/blob/v24.x/tools/install.py) |
| npm/Corepack | npm comes from the Node tarball; Corepack only where that Node release includes it. Image additionally bundles Yarn v1 through Node 25. [Image variants](https://github.com/nodejs/docker-node#image-variants), [Corepack lifecycle](https://nodejs.org/docs/latest-v24.x/api/corepack.html) | npm/Corepack contents are exactly those in the selected Node tarball; no image-added Yarn. Devbox’s separately locked package-manager plan stays explicit. |
| Shared libraries | `/usr/local` relocation does **not** carry retained Debian packages from `/lib`, `/usr/lib`, or dpkg state. | Same final-base obligation. The Node archive does not bundle the whole Debian runtime filesystem. Node documents its Linux ABI baseline. [Node BUILDING](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#official-binary-platforms-and-toolchains) |
| Recipe drift | The digest freezes recipe output, including current image additions/removals. A new exact Node version generally means a new image digest. | Exact URL + checksum freezes archive bytes; Devbox’s extraction recipe is separately owned/versioned in generated build logic. |
| Current lock compatibility | Direct fit for existing `revision` + `image` + `digest` fields. | Requires a deliberate schema interpretation/change to archive URL, archive SHA-256, checksum-manifest identity, and signing-key trust input. |
| Cache shape | Pull/cache the pinned source image, then `COPY --from`; `COPY --link` can improve reuse/rebase where its destination restrictions are acceptable. [Docker `COPY --link`](https://docs.docker.com/reference/dockerfile/#copy---link) | One `RUN` downloads, verifies, extracts, and deletes the archive. Changing the exact-version/checksum ARG invalidates that instruction; a cache hit does not re-check the network URL. [Docker cache invalidation](https://docs.docker.com/build/cache/invalidation/) |

## 4. Why a simple `COPY` can be incomplete or wrong

### 4.1 What `COPY /usr/local` does cover

**Source fact:** Docker says `COPY --from` reads the source path from the specified stage/image filesystem root. For a directory, its contents and filesystem metadata are copied recursively; image configuration is not inherited merely because files are copied. [Dockerfile `COPY --from`](https://docs.docker.com/reference/dockerfile/#copy---from), [Dockerfile directory-copy semantics](https://docs.docker.com/reference/dockerfile/#copying-from-the-build-context)

For Node 24’s official image, `/usr/local` therefore includes the tar-extracted Node tree and its npm/npx/Corepack links, plus the image-added `nodejs` symlink and entrypoint, and the Yarn/Yarnpkg links. Relative npm/npx/Corepack links continue to resolve after the whole tree is relocated because their targets remain under the same new root. This follows the link targets created by Node’s installer. [Node 24 installer](https://github.com/nodejs/node/blob/v24.x/tools/install.py)

### 4.2 Proven omissions and bad links

A copy such as:

```dockerfile
COPY --from=node-source /usr/local/ /opt/devbox/runtimes/node/24/
```

has these source-proven limitations:

1. **Yarn payload omitted:** the image stores Yarn 1.22.22 in `/opt/yarn-v1.22.22`; only the `/usr/local/bin/yarn` and `yarnpkg` symlinks are under `/usr/local`. Copying `/usr/local` alone therefore copies links whose `/opt/yarn-v1.22.22/...` targets were not copied. [Node 24 Trixie Slim Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)
2. **`nodejs` points outside the isolated tree:** the image creates `nodejs` as an absolute link to `/usr/local/bin/node`. After relocation, that link does not point to `/opt/devbox/runtimes/node/24/bin/node`. [same Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)
3. **Shared-library packages omitted:** the Slim recipe’s `ldd`/dpkg retention affects Debian paths outside `/usr/local`. Multi-stage file copy does not import the source stage’s unselected filesystem or package database. [same Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile), [Docker `COPY --from`](https://docs.docker.com/reference/dockerfile/#copy---from)
4. **User/account state omitted:** `/etc/passwd`, `/etc/group`, and `/home/node` are outside `/usr/local`. They belong to the container image experience, not the relocatable Node Runtime. [same Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)
5. **Image configuration omitted:** `ENV NODE_VERSION`, `ENTRYPOINT`, and `CMD` are image metadata/instructions, not files copied from `/usr/local`. Docker explicitly notes, for example, that metadata labels from a stage referenced only with `COPY --from` are not inherited. [Dockerfile metadata inheritance note](https://docs.docker.com/reference/dockerfile/#label)
6. **Image-only entrypoint included:** `/usr/local/bin/docker-entrypoint.sh` *is* copied even though the final Workspace does not need to make it the Node Runtime command. [Node 24 Trixie Slim Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)

Copying `/opt/yarn-v1.22.22` too is not a good multi-version fix: its `/usr/local` and `/opt` absolute links still assume global locations, and Node 26 no longer bundles it. Devbox already has a stronger contract: package managers are exact, separately locked members of each release-line Runtime bundle.

**Unknown:** Docker’s current Dockerfile reference states that directory contents and filesystem metadata are copied, but does not explicitly specify every source-symlink dereference edge case for all builders/frontends. The recommendation does not depend on an undocumented edge: preserve and then inspect/normalize the known links, or construct the release-line tree from known tar-origin paths. `COPY --link` also has documented restrictions around symlinks in the *destination* path. [Docker `COPY --link` incompatibilities](https://docs.docker.com/reference/dockerfile/#incompatibilities-with-linkfalse)

## 5. Native addons and ABI

**Source fact:** The Node distribution index exposes a `modules` number for each exact release; that is a useful signal that an exact Node revision is more than a release-line label. [Node distribution index](https://nodejs.org/dist/index.json)

**Source fact:** Node-API is ABI-stable across Node versions and is designed to insulate addons from changes in V8. Node explicitly says the Node C++ APIs (`node.h`, `node_buffer.h`, `node_version.h`, `node_object_wrap.h`), V8, libuv, and any external addon libraries do not receive the same cross-major ABI guarantee. [Node 24 Node-API ABI guarantee](https://nodejs.org/docs/latest-v24.x/api/n-api.html#node-api), [implications and exclusions](https://nodejs.org/docs/latest-v24.x/api/n-api.html#implications-of-abi-stability)

**Implications for both source choices:** Because the official image uses the official tarball, choosing image versus tarball does not change Node’s addon ABI for the same exact version and architecture. Native addon correctness instead depends on:

- the selected exact Node revision/ABI;
- target architecture (`amd64` versus `arm64`);
- libc and external shared libraries in the final Debian Base;
- whether the addon exclusively uses a supported Node-API version or targets unstable Node/V8 APIs;
- where and for which Runtime release line the addon was compiled.

Devbox should not share compiled `node_modules` native artifacts between different architectures or assume they are portable across Node major release-line roots. Node-API can permit cross-Node reuse, but only within its stated API/version and external-library constraints; source provenance alone cannot prove that property.

## 6. BuildKit layers and cache

**Source fact:** Docker checks the base image cache first. `COPY`/`ADD` cache keys include file metadata; ordinary `RUN` caching generally compares the instruction rather than examining files fetched from the network. Once a layer misses, following instructions miss as well. [Docker cache invalidation rules](https://docs.docker.com/build/cache/invalidation/)

**Source fact:** Build ARG values affect cache use when consumed. Thus an exact Node revision, source digest/checksum, or target architecture used by a stage gives BuildKit an explicit cache boundary. [Dockerfile ARG cache impact](https://docs.docker.com/reference/dockerfile/#impact-on-build-caching)

**Source fact:** `RUN --mount=type=cache` persists a cache directory across builder invocations without invalidating the instruction cache, but Docker warns that builds must remain correct if the cache is overwritten or garbage-collected. [Docker cache mounts](https://docs.docker.com/reference/dockerfile/#run---mounttypecache)

**Devbox implications:**

- **Source image:** digest change invalidates the source identity; copying a stable normalized Runtime tree gives one reusable layer per exact release/architecture. `COPY --link` may improve reuse when earlier source-stage layers change, but is an optimization, not a correctness requirement. [Docker `COPY --link` benefits](https://docs.docker.com/reference/dockerfile/#benefits-of-using-link)
- **Tarball:** keep download + signature/checksum verification + extraction + archive deletion in one `RUN`, so the compressed archive and GPG work files do not survive as extra final layers. An exact checksum/version change must be part of that instruction’s cache key. A warm `RUN` cache will not contact Node’s server again; correctness on a cold build comes from locked SHA-256/signature verification, not from assuming the URL is immutable. [Docker RUN cache rule](https://docs.docker.com/build/cache/invalidation/#run-instructions)
- **Cache mounts:** a download cache can save bandwidth, but it adds naming/concurrency/GC behavior. It is unnecessary for correctness and is not the simplest first implementation for a roughly once-per-exact-release archive.
- **Both:** put Runtime-source stages before frequently changing Agent/project layers so later churn does not destroy the Runtime cache. Docker recommends ordering stable instructions before frequently changing ones. [Docker cache ordering](https://docs.docker.com/build/cache/invalidation/#general-rules)

## 7. Exact Platform-lock inputs for each alternative

These lists separate the **release-line request** (`24`) from the **exact resolved artifact** (`24.19.0`). Package-manager fields remain required under either source choice; their registry revisions/integrities are not safely inferred from a floating release line.

### Alternative A — digest-pinned source image (recommended under current ADRs)

For each Node release line and target platform, lock:

- `release_line`: e.g. `24`;
- `revision`: exact Node version, e.g. `24.19.0`;
- `source.image`: exact human-auditable tag, e.g. `node:24.19.0-trixie-slim`;
- `source.index_digest`: immutable OCI index digest;
- `source.platform`: e.g. `linux/amd64` or `linux/arm64`;
- `source.manifest_digest`: resolved immutable child-manifest digest if the lock requires per-platform byte identity;
- `package_managers.npm.revision` and registry integrity;
- `package_managers.corepack.revision` and registry integrity;
- `package_managers.pnpm.revision` and registry integrity;
- `package_managers.yarn.revision` (constrained by the ADR to 1.x) and registry integrity.

Docker documents that tags are mutable and digest pinning selects the same image even after the tag moves. [Docker pinning guidance](https://docs.docker.com/build/building/best-practices/#pin-base-image-versions) The exact tag remains useful audit context, but the digest is the identity.

**Unknown/design choice:** Existing ADR wording says `source image` and `digest` but does not state whether `digest` is the multi-platform index or the selected child manifest. The lock serializer/resolver should name this explicitly before amd64 + arm64 are both supported; silently mixing the two kinds of digest would be ambiguous.

### Alternative B — direct official tarball

For each Node release line and target platform, lock:

- `release_line`;
- `revision`: exact Node version;
- `source.platform` and the Node archive architecture token (`x64` or `arm64`);
- exact archive URL, e.g. `https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz`;
- exact archive SHA-256 selected from that release’s signed `SHASUMS256.txt.asc`;
- exact checksum-manifest URL;
- the signature-verification trust input: at minimum a versioned/hashed Node release keyring or the accepted releaser key fingerprint, rather than an unpinned “whatever keyserver returns” dependency;
- a Devbox extraction/normalization recipe identity if generated-recipe changes must affect Workspace identity independently of upstream bytes;
- the same four exact package-manager revision/integrity mappings listed above.

[Node’s verification instructions](https://github.com/nodejs/node/blob/main/README.md#verifying-binaries) establish the signed-manifest process. The official docs do **not** prescribe a Platform-lock schema or a long-term keyring pinning policy; those are Devbox design responsibilities.

## 8. Final recommendation for ADR-0035

**Devbox recommendation:** Choose **Alternative A: digest-pinned official Trixie Slim source image** for the current branch.

Why it is the simplest compatible decision:

1. The source image’s Node payload is already the official precompiled tarball, verified against Node’s signed SHA-256 manifest; there is no Node-build quality difference to recover by repeating the download. [official Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile)
2. Existing Node lock entries already have the right provenance vocabulary—exact Runtime revision, source image, and immutable digest—whereas direct tarballs require a new archive/signature trust schema.
3. Docker natively resolves the correct manifest from a multi-platform index and can cache/reuse a multi-stage copy. [Docker multi-platform images](https://docs.docker.com/build/building/multi-platform/#difference-between-single-platform-and-multi-platform-images), [`COPY --from`](https://docs.docker.com/reference/dockerfile/#copy---from)
4. It fits ADR-0035’s one generated Dockerfile: Base stages first, one digest-pinned Node source/normalization stage per configured release line, then the final Workspace assembly. No separately materialized local Runtime image or host staging directory is needed.
5. The known image-layout hazards are finite and proven by the official Dockerfile: exclude `docker-entrypoint.sh`, rewrite/drop the absolute `nodejs` link, do not copy the image’s `/opt/yarn-*`, and source shared-library packages from the locked Base native-package plan.

The resulting bundle contract should be content-oriented, not an imitation of the source container:

```text
/opt/devbox/runtimes/node/24/bin/node
/opt/devbox/runtimes/node/24/bin/npm
/opt/devbox/runtimes/node/24/bin/npx
/opt/devbox/runtimes/node/24/bin/corepack   # only when the locked plan installs it
/opt/devbox/runtimes/node/24/lib/...
/opt/devbox/runtimes/node/24/include/...
/opt/devbox/runtimes/node/24/share/...
```

The bundle should not depend on `/usr/local/bin/node`, `/opt/yarn-v1.22.22`, the source image’s `ENTRYPOINT`, or its `node` account. Exact npm/Corepack/pnpm/Yarn contents come from the lock’s package-manager entries, so behavior remains consistent when upstream bundling changes at Node 25/26.

Choose direct tarballs later only if Devbox intentionally decides that the Node release archive—not Docker Official Image publication—is the canonical Runtime source and accepts the corresponding Platform-lock and signature-key lifecycle changes. That is a valid clean architecture, but not the minimum change under the current ADRs.
