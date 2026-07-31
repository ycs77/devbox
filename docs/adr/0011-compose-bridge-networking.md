# Use Compose bridge networking with outbound access by default

A Sandbox joins its generated Compose project's bridge network and uses Docker's standard outbound connectivity, allowing AI Agent APIs, package managers, and remote Git to work without extra setup. The initial Local configuration schema exposes no network field and Devbox provides no offline, allowlist, denylist, host-network, or local-network mode; a separate authentication operation may still use the networking needed for an upstream OAuth callback.
