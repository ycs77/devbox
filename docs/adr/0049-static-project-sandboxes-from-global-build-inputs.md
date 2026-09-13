# Build one shared Workspace image and publish static Project Sandboxes

> **Status: Accepted (2026-08-30).** This ADR replaces the deferred Project-configuration direction in ADR-0048 and establishes the current configuration, image, Compose, naming, Agent-home, and lifecycle boundaries.

## Decision

Devbox has two user-owned configuration scopes. Global configuration contains the `node`, `agent`, and `agent_notifications` fields; Local configuration contains only the Project's Selected Node Runtime, which may be `null`. `devbox config` first asks whether to edit the Global or current Project scope, replacing `config -g`. `init` uses the same flow: when Global configuration is absent it collects Global configuration and then the current Project's Local configuration; otherwise it collects only Local configuration. A Global Node removal first collects a replacement Selected Node Runtime or `null` for every affected Project, then atomically publishes the Global and Local changes and regenerates every affected static Compose definition. Configuration does not write into a Project workspace.

`devbox build` is the only command that creates or updates the shared `devbox-workspace:latest` Workspace image. It reads committed Global configuration, regenerates the machine-owned Build context, and invokes Docker; it neither renders Project Compose definitions nor starts a Sandbox. The largest Global Node Runtime is the Build Node Runtime. Claude and Codex skills are installed only during that image Build, and only when both the Build Node Runtime and the corresponding configured Agent are present. Agent notifications apply only to Claude, Codex, and OMP.

Configuration and initialization publish static Project Compose definitions. Those definitions contain no `build:` section, reference the shared Workspace image, and set a literal `NODE_VERSION` for the Project's Selected Node Runtime rather than interpolating a host environment variable. The renderer statically selects and combines prototype fragments; Node, Agent, and notification fragments each retain their own TypeScript definitions rather than entering a general recipe, plugin, or template framework. Node entrypoint preflight continues to verify only the installed Selected Runtime.

The Project registry persists two distinct names for each Project. Sandbox identity derives from the complete absolute Project root and assigns the Project state directory under `~/.devbox/projects/`, retaining the existing `-2`, `-3`, and later collision suffixes. Sandbox name derives independently from the Project basename, is Docker-safe, and receives its own persisted collision suffix. Generated Compose uses Sandbox name as its top-level `name`, its Sandbox `container_name`, and its `/workspace/<Sandbox name>` path. It must not fall back to a Compose name inferred from the Project state directory.

Each configured Agent home is mounted through its fixed-name external Shared Agent volume, such as `devbox-claude`. Before `up` invokes Compose, Devbox idempotently creates every Shared Agent volume needed by the current Sandbox with `docker volume create --driver local`; `down`, `stop`, and `sh` do not create volumes. Compose does not own or delete these external volumes.

The public command surface is `init`, `config`, `build`, `rm`, `up`, `down`, `stop`, and `sh`. `up`, `down`, `stop`, and `sh` are Sandbox lifecycle commands: they use the already generated Compose definition and do not configure Devbox or build an image. `sh` executes `bash` for the `devbox` service as the `devbox` user. There are no `exec`, `logs`, or additional lifecycle wrappers.

## Consequences

A missing shared Workspace image is reported by Docker when `up` invokes Compose; `up` does not trigger a Build. Each Project's generated Compose remains an explicit static artifact, so changes to Global configuration that affect Project definitions must regenerate all affected definitions before publication. Sandbox identity, Project state directory, and Sandbox name are separate persisted values with separate collision domains.

## ADR relationships

This ADR supersedes ADR-0030's Local schema, `config -g`, and configuration flow; ADR-0034's `update` stage and `up`-time Compose rendering; ADR-0048's deferred Project-specific Runtime selection and `build.node` shape; ADR-0042's registry value shape; and ADR-0023 and ADR-0001's `exec` and `logs` CLI contracts. It supersedes the incompatible parts of ADR-0001 that render Compose during `up` while preserving its machine-owned retained-Compose boundary. It reinterprets ADR-0010's Agent-home storage as fixed-name external Shared Agent volumes and preserves their user-data retention. ADR-0032's single mutable Workspace-image identity, ADR-0033's machine-owned Build context, ADR-0044's CAC parser choice, ADR-0045's command-lock protocol, and the Host and Project-root boundaries remain current.
