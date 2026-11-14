# Keep Recipe configuration in the Catalog

Devbox keeps Runtime and Agent recipe configuration in the packaged Catalog, while `src/runtimes/<family>` and `src/agent` own the corresponding recipe implementations. The Catalog is the inspectable place to add or update supported release lines and their exact versions, Runtime install roots, Runtime distribution URLs, trusted Node release-key fingerprints, Agent installer URLs and shells, Agent pre-install commands, Agent home volumes and targets, notification support and plugin installation commands, and each Agent's Skill installation target. Family and Agent modules interpret that data into Workspace and Sandbox behavior. This supersedes ADR-0036 only for Runtime recipe configuration ownership, and preserves ADR-0050's Agent installation behavior contract.

Some recipe details deliberately remain in the owning implementation modules rather than the Catalog. `src/runtimes/node` owns the keyserver fallback, architecture mapping, archive verification and extraction steps, and Node global-tool installation commands. `src/agent` owns the packaged Agent image-default assets and where each Agent's instruction and settings files are copied, the shared Agent Skills source and installation command, AGY's Skills link, and the WSLg notification Compose fragment with its PulseAudio socket path. These modules may select behavior by Agent catalog name instead of adding Catalog fields for each detail.

## Consequences

Workspace is the explicit composition point for the Build Node Runtime and Agent Skills dependency. Recipe implementations must not add a generic plugin framework or a shared `src/types.ts`; types remain with their owning module unless they are genuinely cross-domain.
