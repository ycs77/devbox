# Run Sandboxes as a host-matched non-root user

> **Status: Superseded by ADR-0051 (2026-09-09).** The earlier host-matched identity, root-only entrypoint bootstrap, and no-elevation-path rules are historical. The current Sandbox identity and elevation behavior are defined by ADR-0051.

## Historical evidence


On 2026-08-02, a disposable integrated prototype ran Base-only, Node-only, PHP-only, and combined Workspaces on WSL2 `linux/amd64` as the host-matched numeric identity `1000:1000`. Every variant created Project files with that ownership and used the intended login-shell path; the combined Workspace retained cross-Runtime invocation. This is historical evidence for the exercised WSL2 layout, not the current Sandbox permission or package-manager installation contract.

