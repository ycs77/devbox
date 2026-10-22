# Ship the v0.x line as a Node-only MVP

ADR-0049 supersedes this decision's former fixed-Toolchain, configuration, image, and CLI details. The current v0.x delivery boundary remains Node-only on WSL2 `linux/amd64`: Global configuration may include the packaged Node 22 and 24 release lines, and each Project may select one configured Node line or `null`. PHP, Services, and other hosts remain deferred until later decisions change that boundary. The current Node package-manager installation is defined by ADR-0039 and ADR-0048.

## Superseded historical MVP shape

The original v0.x MVP proposed a fixed Node-only Toolchain on a Debian Trixie Base with immutable Workspace assembly and a user-scope Platform lock. This configuration, the `sync` workflow, and the proposed package-manager locking have since been replaced by the shared-image Build and Global/Local configuration model in ADR-0048 and ADR-0049.

## Consequences

The Base includes only Node-MVP requirements. A later PHP release requires its own Base update, Runtime recipe, user-facing configuration, and executable acceptance rather than silently expanding the current Toolchain.