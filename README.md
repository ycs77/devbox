<div align="center">

# @ycs77/devbox

**A opinionated devbox for AI agents.**

[![NPM version][ico-version]][link-npm]
[![Software License][ico-license]](LICENSE)
[![GitHub Tests Action Status][ico-github-action]][link-github-action]
[![Total Downloads][ico-downloads]][link-downloads]

English | [繁體中文](README-zh-TW.md)

</div>

---

## Overview

Devbox gives each project an isolated Docker sandbox designed for AI agents, with Lucas's opinionated development setup. Choose the Node.js release lines and AI agents you use, then work from a consistent container without configuring it yourself.

## Features

- **Container environment for AI agents:** choose Claude Code, Codex, and more during setup, then use them inside the sandbox.
- **Simple setup and project lifecycle:** initialize, start, enter, stop, and remove a sandbox with a few commands.
- **Flexible Node.js environments:** configure Node.js 22 and 24, then select a version for each project.
- **Selective builds:** build only the Node.js versions and AI agents you choose.
- **No project configuration files:** keep Devbox configuration local to your machine, not in your repository.

## Requirements

- **Node.js 22 or later:** installs and runs the CLI with npm.
- **Docker with Docker Compose:** runs the development sandbox.
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

The interactive setup lets you choose the Node.js release lines and AI agents to configure, then select the Node.js version for the current project.

Build the shared workspace image once after setup or after changing global configuration:

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

For example, run `claude`, `codex`, `agy`, or `omp` after opening the shell when that agent was selected during setup.

## Everyday commands

Run these commands from the initialized project directory:

| Command | Description |
| --- | --- |
| `devbox up` | Start the project sandbox. |
| `devbox sh` | Open a Bash shell in the running sandbox. |
| `devbox stop` | Stop the sandbox and preserve it for a later restart. |
| `devbox down` | Stop and remove the sandbox container. |
| `devbox config` | Change the globally configured or current project's Node.js selection. |

## Troubleshooting

### A command says a Devbox marker is occupied

An interrupted process or sudden system shutdown can leave a command marker behind. First confirm that no Devbox process is still running, then remove only the stale marker and retry:

```bash
rm -rf ~/.devbox/locks/<marker>
```

Markers are directories named `global` or `project-<hash>`. Do not remove a marker while its Devbox command is still running.

## Sponsor

If you think this package has helped you, please consider [Becoming a sponsor](https://www.patreon.com/ycs77) to support my work~ and your avatar will be visible on my major projects.

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
