# Use a fixed Sandbox identity with passwordless elevation

> **Status: Accepted (2026-09-09).** This ADR supersedes ADR-0024's host-matched identity, root-only bootstrap, and no-elevation-path rules.

## Decision

The Workspace image creates the `devbox` account and group with the fixed numeric identity `1000:1000`. Generated Project Compose definitions do not pass host UID or GID, and Devbox does not align this account to the invoking developer.

The image grants `devbox` passwordless `sudo`. The entrypoint runs as root to validate a selected Node Runtime and update `/etc/bash.bashrc`; without a command it starts the root-owned idle supervisor. `devbox sh` invokes `docker compose exec --user devbox`, so interactive shells, project tools, and AI Agents run as `devbox` unless they deliberately use `sudo`.

This elevation path is confined to the Sandbox container. Devbox still does not mount the host Docker socket or provide a nested Docker daemon; ADR-0015 remains in force.

## Consequences

Files created in the Project workspace by a non-elevated Sandbox process use container UID and GID `1000:1000`, not a runtime-derived host identity. A host whose Project files use another numeric identity can therefore encounter ownership mismatches.

`sudo` can change the Sandbox container's mutable system state, including APT packages. Those changes are not Workspace-image configuration: they disappear when `down` removes the Sandbox container, while a new Workspace image still comes only from `devbox build`.
