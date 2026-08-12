# Devbox command locks

Devbox uses short-lived command locks to prevent two host-side commands from changing the same state at once. These locks are coordination markers, not locks on Docker containers.

## Project commands

Each Project has its own marker under `~/.devbox/locks/`.

- Two different Projects may run `devbox up` at the same time.
- A second command for the same Project fails immediately while the first command is still running.
- `devbox up` keeps the Project marker until `docker compose up -d` returns. The Docker container may continue running after the marker is removed.
- After `up` returns, `stop`, `down`, `exec`, `logs`, `config`, and other Project commands may run normally.

`up` reads the required Global, Local, Project-registry, and host inputs into one snapshot. A later configuration change does not change an `up` command that has already read its snapshot.

## Global configuration

`devbox config -g` uses the Global marker. It may run while a Project `up` is running because `up` does not use the Global marker. If the two commands start at nearly the same time, the `up` command uses whichever complete configuration it reads first.

`devbox config` uses both the Global marker and its Project marker. This prevents Local and Global configuration changes from validating and writing conflicting choices at the same time.

`init`, `rm`, and `cleanup --missing-projects` also use the Global marker. Operations that affect a specific Project use that Project's marker as well. A command fails immediately when any required marker is already present; Devbox does not wait for it.

## Forced termination and manual cleanup

A command removes its markers after normal success, validation failure, operational failure, user cancellation, or Ctrl-C. `kill -9`, sudden shutdown, WSL failure, or a process crash may leave a marker behind.

Devbox does not provide an `unlock` command and does not guess whether a marker is stale. Before removing a marker manually:

1. Confirm that no Devbox process is running.
2. Remove only the residual marker under `~/.devbox/locks/`.
3. Run the failed command again.

Never remove a marker while its Devbox command is still running. Doing so can allow two commands to modify the same Project or Global state at once.

The coordination rules for future `build`, `update`, and other operations that modify shared Docker or Platform artifacts will be documented separately when those operations are implemented.
