# Store host-side Devbox data under ~/.devbox

ADR-0032 supersedes this decision's cleanup of fingerprinted Workspace tags: Devbox now publishes only `devbox-workspace:latest`, and existing Sandbox containers protect the exact older images they use. The host-side data-root decision remains in force, while final old-container and image cleanup behavior is decided with the common lifecycle.

ADR-0033 adds the machine-owned generated Workspace build context at `~/.devbox/build/workspace/`; it is derived input for BuildKit rather than a supported configuration or cache interface.

ADR-0035 removes Devbox-owned Base tags entirely; cleanup no longer evaluates or protects a separately materialized Base image.

ADR-0042 adds the machine-owned `~/.devbox/projects.yaml` Project registry and supersedes Local `config.yaml` presence as registration truth. ADR-0045 adds the machine-owned `~/.devbox/locks/` command-marker directory and supersedes the former OS advisory-lock and `devbox-host` assumptions. Global and Local configuration remain the only human-editable Devbox files.

Devbox stores all host-side user-scope files under `~/.devbox` on the supported WSL2 host rather than using XDG directories. The human-editable Global configuration is `~/.devbox/config.yaml`; the machine-owned Project registry and Platform lock are `~/.devbox/projects.yaml` and `~/.devbox/platform-lock.yaml`; machine-owned Global and Project command markers are under `~/.devbox/locks/`; Docker-managed volumes remain in Docker storage. Each Project-registry entry assigns one flat direct child under `~/.devbox/projects/`, where human-editable Local configuration is `config.yaml` and machine-owned retained Compose is `compose.yaml`.

Global `~/.devbox/config.yaml` and each Project's Local `config.yaml` are the only Devbox-supported human-editable file interfaces. The Platform lock, command markers, temporary candidate files, generated Compose definitions, and other Devbox state files are machine-owned: users may inspect readable contents for troubleshooting, but manual edits are unsupported. If abnormal termination leaves a command marker, the user may remove that marker only after confirming that no Devbox process is running; Devbox provides no unlock command.

The initial release creates no host-side log or cache directory. It creates `~/.devbox/locks/` only for short-lived command markers; commands report directly through terminal output, while Docker and BuildKit retain their own rebuildable cache. `devbox cleanup` removes only planned disposable temporary files, stopped Project-scoped Compose resources, and eligible unreferenced old Workspace images; it preserves `devbox-workspace:latest`, Global and Local configuration, the Platform lock, Project registrations except those explicitly selected by `--missing-projects`, and every Docker volume. It does not prune BuildKit cache because the builder boundary cannot reliably attribute that cache to Devbox alone.
