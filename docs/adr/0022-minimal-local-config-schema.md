# Keep the initial Local configuration schema minimal

> **Status: Superseded by ADR-0049 (2026-08-30).** The current Local `config.yaml` has exactly `version: 1` and `node`, where `node` is one Global-configured Node release line or `null`. It has no `toolchain`, `agent`, `ports`, Services, network, resource, SSH, mount, credential, Agent-state, or Git-configuration fields.
