# Use simple command locks for current Project operations

Devbox removes the planned Go `devbox-host` helper and accepts that command markers may remain after a forced process termination. Current configuration and Project operations use simple non-waiting command locks under `~/.devbox/locks/`: one Global command lock for user-scope state and one Project command lock per Project. This keeps different Projects' `up` commands parallel while making a second command for a busy scope fail immediately; users may remove a residual marker manually only after confirming that no Devbox process is running.
Removing the helper also removes the former package split. The current package boundary is one pnpm-managed package at the repository root, published as `@ycs77/devbox`; ADR-0046 records that no pnpm workspace, platform package, native Go module, or multi-package release flow is part of the current design.

## Decision

`devbox up` takes only its Project command lock. It reads the Project registry and retained Compose definition and, only to create the Shared Agent volumes needed by that definition, the current Global configuration; it does not read Local configuration or render Compose. It holds the Project command lock through the complete host-side `docker compose up -d` invocation and releases it as soon as Compose returns, whether Compose succeeds, fails, or the command is cancelled. The lock does not last for the Sandbox container's background lifetime. Different Projects can run `up` concurrently; any other command targeting the same Project fails while its `up` command is still running, but may run after Compose returns.

Global configuration operations take only the Global command lock. `init`, Local `config`, and `rm` take the Global command lock plus their current Project command lock because they publish the registry or static Compose definitions; `cleanup --missing-projects` acquires the Global lock and every affected Project lock before deleting anything. Required locks fail immediately rather than waiting. Commands release every lock on normal success, validation failure, operational failure, user cancellation, or Ctrl-C; forced termination, sudden shutdown, or process failure may leave a marker for manual cleanup. Devbox provides no automatic stale-marker cleanup.

The Global lock does not coordinate `up`. If Global configuration changes while `up` reads it to create Shared Agent volumes, `up` uses the complete configuration it observed; its retained Compose definition remains unchanged. `build` takes the Global lock because it regenerates the shared machine-owned Build context and replaces the common Workspace image.

## Consequences

This decision deliberately gives up automatic crash recovery for command markers and requires clear user documentation for safe manual cleanup. In return, the current package needs no Go executable, native addon, daemon, socket coordinator, PID lease protocol, or waiting queue, while its supported Project-level concurrency remains explicit and easy to explain.
