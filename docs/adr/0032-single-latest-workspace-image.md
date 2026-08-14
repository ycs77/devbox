# Publish one latest Workspace image without persisted identity

> **Current status (2026-08-14):** ADR-0048 supersedes this ADR's Platform-lock source for the Workspace plan. The single latest Workspace-image direction remains, but Build inputs now come from Global `build.node` and packaged recipes.

ADR-0041 supersedes this decision's Configured-Agent Workspace build input: the common image now contains only Base and Configured Runtime contents, while every Project Sandbox installs Configured Agents during first-start bootstrap independently of its Toolchain. The single mutable `devbox-workspace:latest` identity and old-image retention rules remain in force.

Devbox removes the custom Workspace fingerprint and does not persist a Workspace image ID, generation, or candidate registry. Each explicit `build` regenerates the fully resolved Workspace plan from the Platform lock, relies only on BuildKit's internal cache, and builds directly to the single local `devbox-workspace:latest` tag; all retained Compose definitions use that mutable reference.

Running Sandbox containers remain attached to the immutable Docker image from which they were created when `latest` moves. A later Compose-only `up` may recreate that Project's container when its referenced image changed, but it does not verify that `latest` corresponds to the current Platform lock. Devbox accepts that explicit stages may remain out of sync in exchange for removing the Workspace fingerprint schema, canonical encoder, immutable Workspace tags, and persisted publication identity.

`update`, or `build` when no Platform lock exists, resolves the complete exact plan for the Configured Runtime set. Build consumes the resulting lock's exact Base entry and every exact Runtime entry together with current packaged Runtime and Workspace recipes; it never reads floating upstream releases or modifies an existing lock. Resolution failure preserves the prior lock, while Docker build failure preserves the prior usable `latest`.

The Configured Agent set is not a Workspace build input. The common image contains no Agent executable; each new or replacement Sandbox installs the then-current complete Configured Agent set during first-start bootstrap, while Agent homes, credentials, configuration, and mutable state remain outside the image under their separately defined lifecycle.

Devbox keeps no historical Workspace tags or image registry after `latest` moves. An existing Devbox Sandbox container is the source of truth for its exact old Docker image and protects that image's layers whether the container is running or stopped. An old untagged Workspace image becomes cleanup-eligible only when no Sandbox container references it; one confirmed Cleanup plan may remove its sole stopped-container references first and then recheck and remove the newly unreferenced image.
