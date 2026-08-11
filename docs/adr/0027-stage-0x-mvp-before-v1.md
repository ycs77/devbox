# Stage a usable v0.x MVP before the stable v1.0 release

Devbox ships in two deliberate stages. The v0.x line is an intentionally incomplete but usable Node-only MVP: its narrow acceptance must work end to end, but its public behavior is not yet the complete stable Devbox offering. The v1.0 release is reached only when the previously designed first-release scope is complete and verified for Lucas's own development needs, including the PHP-plus-Node Toolchain and the associated Project, Sandbox, configuration, lifecycle, and safety contracts.

v0.x may evolve its incomplete surfaces as the MVP exposes real needs; v1.0 establishes the stable public compatibility boundary. Work not required for v1.0 is neither implied by this roadmap nor pre-committed: it is considered only when a concrete need appears. Publication channel and version-number execution remain release decisions; this ADR defines scope and completion gates, not an automatic npm release.

## Consequences

ADR-0026 remains the Node-only v0.x delivery boundary only where its opening supersession notice says so; current Workspace, configuration, CLI, Platform, Base, Agent, and lifecycle behavior comes from ADR-0029 through ADR-0043. New tickets and acceptance claims must identify their delivery stage without reviving the superseded Build-and-Sync flow.