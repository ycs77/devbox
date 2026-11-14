# Keep the initial Local configuration schema minimal

> **Status: Superseded by ADR-0049 (2026-08-30) and ADR-0052 (2026-09-10).** The current Local `config.yaml` has `version: 1`, `node`, and an optional `ports` list, where `node` is one Global-configured Node release line or `null` and `ports` holds the Project's published port mappings. It has no `toolchain`, `agent`, Services, network, resource, SSH, mount, credential, Agent-state, or Git-configuration fields.
