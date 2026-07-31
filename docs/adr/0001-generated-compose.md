# Generate Compose outside the project

Devbox manages a Sandbox and any future Services by generating an internal Compose definition in Devbox-owned user data and invoking Docker Compose. The initial release ships no Service catalog and generates Sandbox-only definitions, while retaining Compose as the lifecycle and networking foundation for later curated Services. This keeps projects free of required Docker configuration and avoids rebuilding Compose semantics around individual `docker run` calls; generated Compose is an implementation detail, not a user extension surface.

The generated definition for a Project is the machine-owned `compose.yaml` stored beside that Project's Local configuration at `~/.devbox/projects/<mirrored-project-root>/compose.yaml`. Co-location does not make it a supported editing or extension interface, and only the neighboring `config.yaml` registers the Project.

The retained file represents the most recently synchronized desired Sandbox definition rather than a continuously refreshed view. A successful explicit `devbox sync`, or the same synchronization invoked automatically by `up`, deterministically renders it and atomically rewrites it only when its contents differ; Devbox keeps no dirty flag, input-fingerprint sidecar, or Compose freshness metadata. Configuration and Platform changes take effect in this definition through the next sync, while `down`, `shell`, and `exec` read the retained file without regenerating it.

Sync writes Compose last. If rendering or its atomic write fails, the command fails and retains the previous `compose.yaml`, while already validated Local configuration and any verified Platform lock or Workspace image preparation remain committed for a later retry.
