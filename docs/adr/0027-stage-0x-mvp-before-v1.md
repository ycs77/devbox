# Stage a usable v0.x MVP before the stable v1.0 release

Devbox ships in two deliberate stages. The v0.x line is an intentionally incomplete but usable Node-only MVP: its narrow acceptance must work end to end, but its public behavior is not yet the complete stable Devbox offering. The v1.0 release is reached only when the previously designed first-release scope is complete and verified for Lucas's own development needs, including the PHP-plus-Node Toolchain and the associated Project, Sandbox, configuration, lifecycle, and safety contracts.

v0.x may evolve its incomplete surfaces as the MVP exposes real needs; v1.0 establishes the stable public compatibility boundary. Work not required for v1.0 is neither implied by this roadmap nor pre-committed: it is considered only when a concrete need appears. Publication channel and version-number execution remain release decisions; this ADR defines scope and completion gates, not an automatic npm release.

## Consequences

ADR-0026 is the v0.x delivery target. ADR-0005 and the broader Build and Sync specification describe the intended v1.0 scope rather than work required to complete v0.x. New tickets and acceptance claims must identify which stage they serve.