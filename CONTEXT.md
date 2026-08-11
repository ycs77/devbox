# Devbox

Devbox lets users configure a Toolchain for each Project and starts its Sandbox with Lucas's opinionated defaults and curated Runtime and AI Agent catalogs.

## Language

**Toolchain**:
Zero or more Selected Runtimes plus Lucas-curated development tools and settings made available together in a Project's Sandbox.
_Avoid_: Development environment

**Runtime**:
A language execution environment selected independently by release line and combined with other selected Runtimes into a Toolchain.

**Runtime catalog**:
The finite package-managed set of Runtime family and release-line pairs that Devbox recognizes and claims it can resolve from an official source and install compatibly with the current Base profile, ordered within each family. A release line enters the catalog only through a Devbox package update.

**Agent catalog**:
The finite package-managed set of AI Agents that Devbox can install through an official Runtime-independent installation path compatible with the current Base profile and runnable by the Sandbox user without elevation. An AI Agent enters the catalog only through a Devbox package update.

**Built-in suggestions**:
The ordered Runtime catalog entries presented as Devbox's Runtime choices. The two sets are identical, and the first entry for a family is its initialization default.

**Selected Runtime**:
A Runtime release line chosen from the Configured Runtime set for one family in a Project's Toolchain. Selection defines Devbox-supported command resolution and entrypoint preflight, not exclusive access to Runtime capabilities present in the shared Workspace image.

**Configured Runtime set**:
The user-scope subset of Runtime catalog entries selected in Global configuration for exact resolution and the next Workspace build. It may differ from the contents of the last successfully built Workspace image while explicit stages remain incomplete. A Runtime remains configured only because it is desired globally, not because an existing Sandbox still uses an older Workspace image containing it; removal is rejected while any Local configuration, including a Missing-root Project registration, still selects it.

**Base profile**:
The single versioned userland ABI shared by Devbox and every compatible Runtime bundle. It is selected by Devbox rather than by project users.

**Runtime bundle**:
A Base-profile-compatible, independently reusable Runtime installation placed at an isolated path and linked into Workspace images.

**Workspace image**:
An immutable image built from exact Base-profile inputs and the Configured Runtime set, then shared by every Project Sandbox independently of its Toolchain. Its latest successful build is used for new or recreated Sandboxes, while existing Sandbox containers may continue using an older build.

**AI Agent**:
An AI coding agent from the Configured Agent set that works inside every Project Sandbox with writable access to its Project workspace.

**Configured Agent set**:
The user-scope subset of Agent catalog entries selected in Global configuration for installation and availability in every Project Sandbox, independently of its Toolchain. Existing Sandbox containers retain their earlier installed set across stops and starts until they are replaced.

**Agent credentials**:
The authentication material stored in an Agent home, shared across Devbox projects but kept separate from the developer's normal host credentials.

**Agent home**:
A Devbox-managed user-scope home for one AI Agent's credentials, configuration, and mutable state, shared read-write across every Project Sandbox and kept separate from the developer's normal host Agent home. Every Sandbox-user process can read or modify every mounted Agent home. It is retained as user data independently of Agent availability, Project registration, Sandbox lifecycle, and Cleanup.

**Sandbox**:
The Project-scoped execution environment with its own container, workspace mount, process space, Compose network, writable layer, and lifecycle. Its writable boundary includes the current Project workspace and shared Agent homes but excludes the rest of the developer's machine by default. It protects the host environment, not Project contents or one Project's Agent credentials and state from another Project.


**Sandbox user**:
The non-root account that runs interactive shells, commands, project tools, and available AI Agents inside a Sandbox after its UID and GID are aligned with the developer invoking Devbox.


**Service**:
A Devbox-supported dependency that runs alongside a Sandbox but is not part of its Toolchain, such as a database, cache, or local mail server.

**Built-in defaults**:
Lucas-curated Devbox options distributed as part of the package and changed through package updates rather than user configuration.

**Global configuration**:
The complete user-owned configuration shared across all Projects, defining the Configured Runtime set and Configured Agent set. Project registration removal never changes it; an item becoming unused only makes it eligible for a separate explicit Global configuration change.

**Platform lock**:
The user-scope exact build plan mapping the current Base profile, its upstream source and curated native packages, and the Configured Runtime set to the single artifact revisions and digests that `build` consumes. It may be newer than the last successfully built Workspace image while explicit stages remain incomplete. AI Agents are outside this lock.


**Project**:
One project root directory registered with Devbox; separate subdirectories, clones, and Git worktrees are distinct Projects even when they originate from the same repository.

**Project registry**:
The machine-owned user-scope record that is the sole authority for which exact Project roots are registered with Devbox.
_Avoid_: Project index

**Missing-root Project registration**:
A retained Project registration whose exact absolute Project root cannot be found at observation time. It does not imply that the root was permanently deleted or relocated.

**Cleanup plan**:
The single confirmed set of disposable Devbox-owned resources selected for one cleanup operation. It may include a resource that becomes eligible only after an earlier removal in the same plan.

**Local configuration**:
The complete user-owned configuration for one Project, stored in user scope and never supplied or fixed by files in the Project workspace.
_Avoid_: Project configuration, Project lockfile

**Project workspace**:
The project directory intentionally made writable inside a Sandbox. Its files, including uncommitted changes, are allowed to be modified or deleted by processes in that Sandbox.
_Avoid_: Host workspace
