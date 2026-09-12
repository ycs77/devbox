# Keep Recipe configuration in the Catalog

Devbox keeps every Runtime and Agent recipe configuration in the packaged Catalog, while `src/runtimes/<family>` and `src/agent` own the corresponding recipe implementations. The Catalog is the single inspectable place to add or update supported release lines, installers, paths, sources, trust policy, homes, and capabilities; family and Agent modules interpret that data into Workspace and Sandbox behavior. This supersedes ADR-0036 only for Runtime recipe configuration ownership, and preserves ADR-0050's Agent installation behavior contract.

## Consequences

Workspace is the explicit composition point for the Build Node Runtime and Agent Skills dependency. Recipe implementations must not add a generic plugin framework or a shared `src/types.ts`; types remain with their owning module unless they are genuinely cross-domain.
