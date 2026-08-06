# Ship the v0.x line as a Node-only MVP

The v0.x line supports exactly one Node Toolchain: immutable Node `24.19.0` plus exact Built-in npm, Corepack-backed pnpm, and Yarn revisions on WSL2 `linux/amd64`. It uses a Node-only Debian Trixie Base, an isolated Node Runtime bundle, and immutable Workspace assembly; the user-scope Platform lock records every upstream and local artifact identity, and `sync` never updates them implicitly.

This deliberately narrows the v1.0 PHP-plus-Node catalog defined by ADR-0005. PHP, Runtime selection, `devbox.yaml`, Runtime updates, Services, AI Agents, and other hosts are incomplete v0.x work, not current support. The public v0.x MVP is `init`, `sync`, `up`, `exec`, and `down`; it is release-ready through `npm pack` verification but does not claim v1.0 stability.

## Consequences

The Base includes only Node-MVP requirements. A later PHP release requires its own Base update, Runtime recipe, Workspace identity, user-facing configuration, and executable acceptance rather than silently expanding the current Toolchain.