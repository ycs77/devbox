# Store host-side Devbox data under ~/.devbox

> **Current status (2026-09-09):** ADR-0048 retires `~/.devbox/platform-lock.yaml`; ADR-0049 restores Local configuration. `~/.devbox/config.yaml` is Global configuration, each registered Project has `~/.devbox/projects/<Sandbox identity>/config.yaml`, and the machine-owned Project registry and generated Build context remain separate.

ADR-0032 supersedes this decision's fingerprinted Workspace-tag retention model: Devbox now publishes only `devbox-workspace:latest`, and existing Sandbox containers protect the exact older images they use. The host-side data-root decision remains in force.

ADR-0033 defines the machine-owned generated Workspace build context directly at `~/.devbox/build/`; it is derived input for BuildKit rather than a supported configuration or cache interface.

ADR-0035 removes Devbox-owned Base tags entirely.

ADR-0042 adds the machine-owned `~/.devbox/projects.yaml` Project registry and supersedes Local `config.yaml` presence as registration truth. ADR-0045 adds the machine-owned `~/.devbox/locks/` command-marker directory and supersedes the former OS advisory-lock and `devbox-host` assumptions. Global configuration and a registered Project's Local configuration are the only human-editable Devbox files.

Devbox stores all host-side user-scope files under `~/.devbox` on the supported WSL2 host rather than using XDG directories. The human-editable Global configuration is `~/.devbox/config.yaml`; the machine-owned Project registry is `~/.devbox/projects.yaml`; machine-owned Global and Project command markers are under `~/.devbox/locks/`; Docker-managed volumes remain in Docker storage. Each Project-registry entry assigns one flat direct child under `~/.devbox/projects/`, whose user-owned Local configuration is `config.yaml` and whose machine-owned retained Compose definition is `compose.yaml`.

Global `~/.devbox/config.yaml` and each registered Project's Local `config.yaml` are the current human-editable Devbox configuration interfaces. Command markers, temporary Build inputs, generated Compose definitions, and other Devbox state remain separate from those files; there is no current Platform lock file.

The initial release creates no host-side log or cache directory. It creates `~/.devbox/locks/` only for short-lived command markers; commands report directly through terminal output, while Docker and BuildKit retain their own rebuildable cache. Global configuration and each Project's retained state remain user-scoped.
