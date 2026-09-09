# Devbox

Devbox builds one shared Workspace image from Global configuration and starts a Sandbox for each Project with Lucas's opinionated defaults and curated Runtime and AI Agent catalogs.

## Language

**Toolchain**:
Zero or more Selected Runtimes plus Lucas-curated development tools and settings made available together in a Project's Sandbox.
_Avoid_: Development environment

**Runtime**:
A language execution environment selected independently by release line and combined with other selected Runtimes into a Toolchain.

**Runtime catalog**:
The finite package-managed set of Runtime family and release-line pairs that Devbox recognizes and claims it can build through an official source and a compatible packaged Runtime recipe, ordered within each family. A release line enters the catalog only through a Devbox package update.

**Runtime recipe**:
A packaged, family-owned definition of a Runtime release line, including its supported source version and the behavior needed to make that Runtime available in a Workspace image.
**Agent catalog**:
The finite package-managed set of AI Agents that Devbox can install into a Workspace image through an official Runtime-independent path compatible with the current Base profile and runnable by the Sandbox user without elevation. An AI Agent enters the catalog only through a Devbox package update.
**Agent recipe**:
A packaged, Agent-owned definition of the official installer and command path required to make one AI Agent available in a Workspace image.

**Built-in suggestions**:
The ordered Runtime catalog entries presented as Devbox's Runtime choices. The two sets are identical, and the first entry for a family is its initialization default.

**Selected Runtime**:
A Runtime release line chosen from the Configured Runtime set for one family in a Project's Toolchain. Selection defines Devbox-supported command resolution and entrypoint preflight, not exclusive access to Runtime capabilities present in the shared Workspace image.

**Configured Runtime set**:
The user-scope subset of Runtime catalog entries listed in Global configuration for the next Workspace build. It describes which Runtime release lines the shared Workspace image should contain; a future Project configuration may select one of those available lines for a Project's Toolchain.

**Build Node Runtime**:
The numerically greatest enabled Node release line, used to install Agent skills in the Workspace image. It is absent when no Node release line is enabled and does not determine a Project's Selected Runtime.

**Base profile**:
The single versioned userland ABI shared by Devbox and every compatible Runtime bundle. It is selected by Devbox rather than by project users.

**Runtime bundle**:
A Base-profile-compatible, independently reusable Runtime installation placed at an isolated path and linked into Workspace images.

**Workspace image**:
An immutable image built from the Base profile, Configured Runtime set, Configured Agent set, and enabled Agent notification plugins through packaged recipes, then shared by every Project Sandbox independently of its Toolchain. Its latest successful build is used for new or recreated Sandboxes, while existing Sandbox containers may continue using an older build.

**AI Agent**:
An AI coding agent from the Configured Agent set that works inside every Project Sandbox with writable access to its Project workspace.

**Configured Agent set**:
The user-scope subset of Agent catalog entries enabled in Global configuration for inclusion in the next Workspace image, independently of the Configured Runtime set. Existing Sandbox containers retain their earlier installed set across stops and starts until they are replaced.

**Agent notifications**:
A Global configuration choice that includes notification plugins for each enabled compatible AI Agent in the next Workspace image. Claude Code, Codex, and OMP are compatible; AGY has no notification plugin.

**Agent notification plugin**:
An Agent-owned extension installed in a Workspace image that enables Agent notifications for one supported AI Agent.

**Agent skills**:
The curated skills installed for enabled Claude Code and Codex Agents during a Workspace build when a Build Node Runtime exists.

**Agent credentials**:
The authentication material stored in an Agent home, shared across Devbox projects but kept separate from the developer's normal host credentials.

**Claude host configuration**:
A user-owned Claude configuration file at `~/.devbox/agents/claude/.claude.json`, mounted read-write into every Sandbox with Claude Code configured. Devbox initializes it to an empty object only when absent and never overwrites it.

**Agent home**:
A Devbox-managed user-scope home for one AI Agent's credentials, configuration, and mutable state, shared read-write across every Project Sandbox and kept separate from the developer's normal host Agent home. Every Sandbox-user process can read or modify every mounted Agent home. It is retained as user data independently of Agent availability, Project registration, Sandbox lifecycle, and Cleanup.

**Shared Agent volume**:
The fixed-name external Docker volume that stores one Agent home for every Sandbox where that AI Agent is available. `up` creates it when absent and neither Sandbox lifecycle nor Project-registration operations remove it.

**Sandbox**:
The Project-scoped execution environment with its own container, workspace mount, process space, Compose network, writable layer, and lifecycle. Its writable boundary includes the current Project workspace and shared Agent homes but excludes the rest of the developer's machine by default. It protects the host environment, not Project contents or one Project's Agent credentials and state from another Project.


**Sandbox lifecycle command**:
A Project-scoped CLI command that invokes an already generated Sandbox Compose definition without changing configuration, building a Workspace image, or rendering a replacement definition.

**Sandbox user**:
The non-root account that runs interactive shells, commands, project tools, and available AI Agents inside a Sandbox after its UID and GID are aligned with the developer invoking Devbox.


**Service**:
A Devbox-supported dependency that runs alongside a Sandbox but is not part of its Toolchain, such as a database, cache, or local mail server.

**Built-in defaults**:
Lucas-curated Devbox options distributed as part of the package and changed through package updates rather than user configuration.

**Global configuration**:
The complete user-owned configuration shared across all Projects, including the Configured Runtime set, Configured Agent set, and Agent notifications. It is authoritative for Workspace image contents; Project registration removal never changes it.

**Configuration operation**:
The interactive `devbox config` operation that chooses Global or current-Project scope, changes its configuration, and publishes every affected Sandbox definition.

**Workspace build**:
The explicit operation that creates the shared Workspace image from committed Global configuration without changing Project configuration or Sandbox definitions.

**Sandbox definition**:
The machine-owned static Compose document for one Sandbox. It references the shared Workspace image and is published after relevant configuration changes.

**Configuration snapshot**:
The complete set of Global, Local, Project-registry, and host inputs read by one Project operation before it performs its work; later configuration changes do not alter that operation.
_Avoid_: live configuration

**Global command lock**:
The short-lived coordination state for operations that modify Devbox-wide configuration or Project registration. It does not block `up`, which may use a configuration snapshot while it runs.
_Avoid_: lifecycle lock

**Project command lock**:
The short-lived coordination state for one Project command. It prevents another command for that Project while the host-side command is running, but it does not keep the Sandbox locked after `up` returns.
_Avoid_: container lock



**Project**:
One project root directory registered with Devbox; separate subdirectories, clones, and Git worktrees are distinct Projects even when they originate from the same repository.

**Project registry**:
The machine-owned user-scope record that is the sole authority for exact registered Project roots, stable Sandbox identities, and stable Sandbox names.
_Avoid_: Project index

**Sandbox identity**:
The Project registry's stable full-path-derived namespace for one Sandbox's Project state directory.
_Avoid_: Sandbox name

**Project state directory**:
The Devbox-owned directory holding one Project's Local configuration and Sandbox definition. It is derived from that Project's Sandbox identity.

**Sandbox name**:
The Docker-safe name calculated from a Project basename and persisted by the Project registry. It identifies the Project's Compose project, Sandbox container, and workspace path inside that Sandbox.
_Avoid_: Sandbox identity, Project state directory

**Initialization**:
The interactive registration operation for the current Project. When Global configuration is absent it collects Global and then Local configuration; otherwise it collects only Local configuration.


**Missing-root Project registration**:
A retained Project registration whose exact absolute Project root cannot be found at observation time. It does not imply that the root was permanently deleted or relocated.

**Cleanup plan**:
The single confirmed set of disposable Devbox-owned resources selected for one cleanup operation. It may include a resource that becomes eligible only after an earlier removal in the same plan.

**Local configuration**:
The complete user-owned configuration for one Project, stored in user scope and never supplied or fixed by files in the Project workspace. In the current scope, it contains only the Project's Selected Node Runtime.
_Avoid_: Project configuration, Project lockfile

**Project workspace**:
The registered Project root mounted as the working directory inside its Sandbox. Its files, including uncommitted changes, are allowed to be modified or deleted by processes in that Sandbox.
_Avoid_: Host workspace
