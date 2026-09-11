# Let Sandbox shell sessions bypass command locks

> **Status: Accepted (2026-09-11).** This ADR supersedes only ADR-0045's rule that every command targeting one Project is mutually exclusive and ADR-0049's classification of `sh` as a Sandbox lifecycle command.

## Decision

`devbox sh` is a Sandbox shell session, not a lock-participating Sandbox lifecycle command. It neither acquires nor checks Global or Project command markers, so multiple terminals may execute `docker compose exec --user devbox devbox bash` for the same Sandbox concurrently. Missing or stopped containers remain Docker Compose operational failures.

A shell session does not block `up`, `down`, `stop`, `rm`, or configuration operations. Those operations retain their current command-lock behavior; `down` or `stop` may interrupt an active shell, and `rm` may remove Project state while a shell remains attached to its existing container. Devbox does not coordinate concurrent work performed inside a Sandbox.

Devbox does not inspect a marker without acquiring it: the observation would race with a later lock acquisition and would not let other operations observe the shell. It also does not add reader/writer locks because this narrow shell-concurrency requirement does not justify a more complex marker protocol or its residual-marker recovery burden.