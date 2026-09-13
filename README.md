<div align="center">

# @ycs77/devbox

**An opinionated devbox for AI agents.**

[![NPM version][ico-version]][link-npm]
[![Software License][ico-license]](LICENSE)
[![GitHub Tests Action Status][ico-github-action]][link-github-action]
[![Total Downloads][ico-downloads]][link-downloads]

English | [繁體中文](README-zh-TW.md)

</div>

---

## Overview

Devbox gives each project an isolated Docker sandbox for AI agents, preconfigured with Lucas's development preferences.

## Features

- **Container environment for AI agents:** choose Claude Code, Codex, and more during setup, then use them inside the sandbox.
- **Simple project sandbox management:** initialize, start, enter, stop, and remove a sandbox with a few commands.
- **Flexible Node.js versions:** choose the versions to include, then select one for each project.
- **Selective builds:** build only the Node.js versions and AI agents you choose.
- **No project configuration files:** keep Devbox configuration local to your machine, not in your repository.

## Requirements

- **Node.js 22 or later:** required to install and run the CLI with npm.
- **Docker with Docker Compose:** required to run the development sandbox.
- **Windows:** use Devbox from a **WSL2** Linux distribution with Docker Desktop integration enabled.

## Getting started

Install Devbox globally:

```bash
npm install -g @ycs77/devbox
```

From your project directory, initialize Devbox:

```bash
devbox init
```

The interactive setup lets you choose the Node.js versions and AI agents to include, then select a Node.js version for the current project.

Global configuration controls what goes into the shared Workspace Image. Each Node.js version or AI agent you add makes the image larger and uses more disk space. Projects can use only the Node.js versions included in the image.

Build the shared Workspace Image once after setup or whenever you change global configuration:

```bash
devbox build
```

Start the project sandbox:

```bash
devbox up
```

Open a shell inside the running sandbox and start working with your AI agent:

```bash
devbox sh
```

If you selected an agent during setup, run `claude`, `codex`, `agy`, or `omp` inside the shell.

## Commands

Run these commands from the initialized project directory:

| Command | Description |
| --- | --- |
| `devbox up` | Start the project sandbox. |
| `devbox sh` | Open a Bash shell in the running sandbox. |
| `devbox stop` | Stop the sandbox and preserve it for a later restart. |
| `devbox down` | Stop and remove the sandbox container. |
| `devbox rm` | Stop and remove the current Project's Sandbox, then remove its Devbox state. |
| `devbox config` | Change global settings or this project's configuration. |

## Troubleshooting

### Devbox reports that a command marker is in use

An interrupted command or sudden system shutdown can leave a command marker behind. First confirm that no other Devbox command is still running, then remove the stale marker and retry:

```bash
rm -rf ~/.devbox/locks/<marker>
```

A marker is a directory named `global` or `project-<hash>`. Do not remove a marker while its Devbox command is still running.

## Sponsor

If Devbox has helped you, consider sponsoring my work on Patreon. Your avatar will appear on my major projects.

<p align="center">
  <a href="https://www.patreon.com/ycs77">
    <img src="https://cdn.jsdelivr.net/gh/ycs77/static/sponsors.svg" alt="Sponsors" />
  </a>
</p>

<a href="https://www.patreon.com/ycs77">
  <img src="https://c5.patreon.com/external/logo/become_a_patron_button.png" alt="Become a Patron" />
</a>

## License

[MIT LICENSE](LICENSE)

[ico-version]: https://img.shields.io/npm/v/%40ycs77%2Fdevbox?style=flat-square
[ico-license]: https://img.shields.io/badge/license-MIT-brightgreen?style=flat-square
[ico-github-action]: https://img.shields.io/github/actions/workflow/status/ycs77/devbox/ci.yml?branch=main&label=tests&style=flat-square
[ico-downloads]: https://img.shields.io/npm/dt/%40ycs77%2Fdevbox?style=flat-square
[link-npm]: https://www.npmjs.com/package/%40ycs77%2Fdevbox
[link-github-action]: https://github.com/ycs77/devbox/actions/workflows/ci.yml?query=branch%3Amain
[link-downloads]: https://www.npmjs.com/package/%40ycs77%2Fdevbox
