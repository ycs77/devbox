# Store host-side Devbox data under ~/.devbox

> **Current status (2026-08-14):** ADR-0048 retires `~/.devbox/platform-lock.yaml` from the current data model. `~/.devbox/config.yaml` remains the human-edited Global configuration, while the machine-owned Project registry and generated Build context remain separate. Project Local configuration is deferred.

ADR-0032 supersedes this decision's cleanup of fingerprinted Workspace tags: Devbox now publishes only `devbox-workspace:latest`, and existing Sandbox containers protect the exact older images they use. The host-side data-root decision remains in force, while final old-container and image cleanup behavior is decided with the common lifecycle.

ADR-0033 defines the machine-owned generated Workspace build context directly at `~/.devbox/build/`; it is derived input for BuildKit rather than a supported configuration or cache interface.

ADR-0035 removes Devbox-owned Base tags entirely; cleanup no longer evaluates or protects a separately materialized Base image.

ADR-0042 adds the machine-owned `~/.devbox/projects.yaml` Project registry and supersedes Local `config.yaml` presence as registration truth. ADR-0045 adds the machine-owned `~/.devbox/locks/` command-marker directory and supersedes the former OS advisory-lock and `devbox-host` assumptions. Global and Local configuration remain the only human-editable Devbox files.

Devbox stores all host-side user-scope files under `~/.devbox` on the supported WSL2 host rather than using XDG directories. The human-editable Global configuration is `~/.devbox/config.yaml`; the machine-owned Project registry is `~/.devbox/projects.yaml`; machine-owned Global and Project command markers are under `~/.devbox/locks/`; Docker-managed volumes remain in Docker storage. Each Project-registry entry assigns one flat direct child under `~/.devbox/projects/`, where any future human-editable Local configuration is `config.yaml` and machine-owned retained Compose is `compose.yaml`.

Global `~/.devbox/config.yaml` is the current human-editable Devbox configuration interface. Any future Project Local configuration, command markers, temporary Build inputs, generated Compose definitions, and other Devbox state remain separate from that file; there is no current Platform lock file.

The initial release creates no host-side log or cache directory. It creates `~/.devbox/locks/` only for short-lived command markers; commands report directly through terminal output, while Docker and BuildKit retain their own rebuildable cache. `devbox cleanup` removes only planned disposable temporary files, stopped Project-scoped Compose resources, and eligible unreferenced old Workspace images; it preserves `devbox-workspace:latest`, Global configuration, Project registrations except those explicitly selected by `--missing-projects`, and every Docker volume. It does not prune BuildKit cache because the builder boundary cannot reliably attribute that cache to Devbox alone.
