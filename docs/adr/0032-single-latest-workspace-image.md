# Publish one latest Workspace image without persisted identity

> **Current status (2026-09-09):** ADR-0049 keeps one mutable `devbox-workspace:latest` Workspace image. Its Build input is Global `node`, `agent`, and `agent_notifications` configuration plus packaged recipes; Project-specific Node selection affects static Compose, not the shared image.

The single mutable `devbox-workspace:latest` identity and old-image retention rules remain in force. The common image contains Base, Configured Runtime, and Configured Agent contents.

Devbox removes the custom Workspace fingerprint and does not persist a Workspace image ID, generation, or candidate registry. Each explicit `build` reads committed Global configuration directly, relies only on BuildKit's internal cache, and builds directly to the single local `devbox-workspace:latest` tag; all retained Compose definitions use that mutable reference.

Running Sandbox containers remain attached to the immutable Docker image from which they were created when `latest` moves. A later Compose-only `up` may recreate that Project's container when its referenced image changed, but it does not verify that `latest` corresponds to the current Global configuration. Devbox accepts that explicit Build and lifecycle stages may remain out of sync in exchange for removing the Workspace fingerprint schema, canonical encoder, immutable Workspace tags, and persisted publication identity.

`build` reads Global `node`, Agent, and notification configuration and packaged recipes directly. Docker build failure preserves the prior usable `latest`; Build does not resolve or create a Platform lock.

The Configured Agent set is a Workspace build input. The common image contains every configured Agent executable, while Agent homes, credentials, configuration, and mutable state remain outside the image under their separately defined lifecycle.

Devbox keeps no historical Workspace tags or image registry after `latest` moves. An existing Devbox Sandbox container is the source of truth for its exact old Docker image and protects that image's layers whether the container is running or stopped. An old untagged Workspace image becomes cleanup-eligible only when no Sandbox container references it; one confirmed Cleanup plan may remove its sole stopped-container references first and then recheck and remove the newly unreferenced image.
