# Do not support arbitrary host mounts initially

Devbox does not support user-defined arbitrary host bind mounts. Generated Sandbox Compose mounts the Project workspace, fixed-name Shared Agent volumes, Claude's Devbox-owned `~/.devbox/agents/claude/.claude.json` when Claude Code is configured, and the fixed WSLg Pulse socket only when Agent notifications are enabled for a compatible Agent. These fixed Devbox capabilities are not Local configuration fields and do not expose a generic host-path mounting mechanism.
