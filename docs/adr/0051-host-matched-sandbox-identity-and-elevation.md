# Run Sandboxes as a host-matched non-root user with passwordless elevation

> **Status: Accepted (2026-09-09).** This ADR restores ADR-0024's host-matched identity and supersedes its root-only bootstrap and no-elevation-path rules.

## Decision

`devbox build` snapshots the invoking host process's POSIX numeric UID and GID. It passes them to the Docker build as `USER_ID` and `GROUP_ID`, then the Workspace image creates the `devbox` account and group with those numeric identities. These build arguments are internal build inputs, not user-configurable environment variables. Generated Project Compose definitions do not pass numeric identities to the container, and the entrypoint does not mutate the account at runtime.

The build fails without a fallback or remapping when the host process has no valid non-root numeric identity, or when the image cannot create the matching account or group because of a numeric identity collision. Run `devbox build` as the intended non-root host user.

The numeric identity applies to the newly built Workspace image. Existing Sandbox containers are not mutated; Docker Compose replaces them according to its normal image lifecycle when a later `up` requires it.

The image grants `devbox` passwordless `sudo`. The entrypoint runs as root to validate a selected Node Runtime and update `/etc/bash.bashrc`; without a command it starts the root-owned idle supervisor. `devbox sh` invokes `docker compose exec --user devbox`, so interactive shells, project tools, and AI Agents run as `devbox` unless they deliberately use `sudo`.

This elevation path is confined to the Sandbox container. Devbox still does not mount the host Docker socket or provide a nested Docker daemon; ADR-0015 remains in force.

## Consequences

Files created in the Project workspace by a non-elevated Sandbox process use the numeric UID and GID of the host user that built the Workspace image, avoiding ownership mismatches for that user.

Devbox does not change existing Project workspace files or Shared Agent volume data when a newly built image has a different numeric identity. Their ownership remains unchanged; an explicit, user-confirmed migration would require a separate decision and command.

`sudo` can change the Sandbox container's mutable system state, including APT packages. Those changes are not Workspace-image configuration: they disappear when `down` removes the Sandbox container, while a new Workspace image still comes only from `devbox build`.
