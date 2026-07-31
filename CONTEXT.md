# Devbox

Devbox lets users select a Toolchain and AI Agent, then starts a Sandbox with Lucas's opinionated defaults and a curated catalog of supported options.

## Language

**Toolchain**:
Zero or more selected language Runtimes plus Lucas-curated development tools and settings made available together in a Sandbox.
_Avoid_: Development environment

**Runtime**:
A language execution environment selected independently by release line and combined with other selected Runtimes into a Toolchain.

**Base profile**:
The single versioned userland ABI shared by Devbox and every compatible Runtime bundle. It is selected by Devbox rather than by project users.

**Runtime bundle**:
A Base-profile-compatible, independently reusable Runtime installation placed at an isolated path and linked into Workspace images.

**Workspace image**:
An immutable image assembled on demand from one Base profile and the selected Runtime and AI Agent bundles. Projects with the same selections share it.

**AI Agent**:
The user-selected AI coding agent that works inside a Sandbox with writable access to its Project workspace.

**AI Agent bundle**:
The current reusable installation of one AI Agent in user scope, built from its latest upstream release and shared by every Workspace image that selects that Agent.

**Agent credentials**:
The authentication material stored in an Agent home, shared across Devbox projects but kept separate from the developer's normal host credentials.

**Agent home**:
A Devbox-managed user-scope home for one AI Agent's credentials, configuration, and mutable state, shared read-write by every Devbox project that selects that Agent and kept separate from the developer's normal host Agent home.

**Sandbox**:
An execution environment whose writable boundary includes the current project workspace but excludes the rest of the developer's machine by default. It protects the host environment, not the project contents.


**Service**:
A Devbox-supported dependency that runs alongside a Sandbox but is not part of its Toolchain, such as a database, cache, or local mail server.

**Built-in defaults**:
Lucas-curated Devbox options distributed as part of the package and changed through package updates rather than user configuration.

**Devbox Git configuration**:
The user-scope Git defaults and identity shared by every Sandbox, initialized from Built-in defaults plus user-confirmed host identity suggestions and kept separate from the developer's normal host Git configuration.

**Platform lock**:
The user-scope mapping from the installed Base profile and Runtime or future Service release lines to the single exact artifact revisions and digests shared by every project. AI Agents are outside this lock.


**Project**:
One project root directory registered with Devbox; separate subdirectories, clones, and Git worktrees are distinct Projects even when they originate from the same repository.

**Project configuration**:
A shareable set of project-safe Devbox options fixed by a project. Fixed options are limited to the safe allowlist, shown during initialization, and cannot be changed by the user.

**Local configuration**:
The complete set of choices materialized for one project in user scope. It includes Project configuration values plus the user's answers for every option the project leaves open.

**Resolved configuration**:
A project's Local configuration after its current fixed Project configuration values have been synchronized into it. Devbox combines it with the Platform lock to start the project.

**Project workspace**:
The project directory intentionally made writable inside a Sandbox. Its files, including uncommitted changes, are allowed to be modified or deleted by processes in that Sandbox.
_Avoid_: Host workspace
