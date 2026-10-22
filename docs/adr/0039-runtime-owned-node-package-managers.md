# Install Node global tools in each Runtime tree

ADR-0048 moves Node global-tool installation from Sandbox bootstrap to the Workspace image Build. Each configured Node release line gets its own Runtime tree and global tools.

The Node Runtime recipe extracts the official archive into `/opt/devbox/runtimes/node/<release-line>` and uses npm's native global layout: packages remain under `<prefix>/lib/node_modules` and executables under `<prefix>/bin`. Selecting Node prepends that `bin` directory to the Sandbox `PATH`. Devbox does not relocate global packages or create command shims for Node. Composer remains deferred with the PHP recipe.

For each Node Runtime, Build runs:

```sh
npm install -g npm
npm uninstall -g corepack
npm install -g yarn pnpm @antfu/ni --allow-scripts=pnpm,yarn
```

The resulting `npm`, `pnpm`, `yarn` and `ni` commands come from that Runtime tree. pnpm and Yarn are npm-installed executables, not Corepack dispatchers; Devbox does not configure Corepack-based version selection from a Project's `packageManager` field. The npm global installs resolve their versions during Build; Devbox does not independently pin them in Project state or a Platform lock. A failed Docker build does not replace the prior Workspace image.

Project dependency manifests, lockfiles and installed dependencies such as `node_modules` remain in the writable Project workspace. Devbox configures `/home/devbox/.pnpm-store` as the non-root user's pnpm store; npm, pnpm and Yarn otherwise use their normal per-user caches. Managed global installations belong to the image-owned Runtime trees, while later user-managed global installations are outside the supported lifecycle. Devbox mounts no cross-Project package-manager cache volume.
