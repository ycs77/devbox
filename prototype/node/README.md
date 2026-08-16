# Devbox Node Docker Prototype

## Docker Compose

Before the first start, create the local Claude Code configuration file:

```bash
mkdir -p prototype/node/data
printf '{}\n' > prototype/node/data/.claude.json
```

Start the devbox container with:

```bash
docker compose -f prototype/node/compose.yaml up -d
docker compose -f prototype/node/compose.yaml exec -it -u devbox devbox bash
docker compose -f prototype/node/compose.yaml down
```

Or just run the devbox container with:

```bash
docker compose -f prototype/node/compose.yaml run --rm -it -u devbox devbox bash
```

## Docker Run

### Default Node.js 24

Enter the prototype image with the default Node.js 24 runtime:

```bash
docker run --rm -it -u devbox -v "$PWD:/workspace" devbox:latest
```

### Node.js 22

Switch to Node.js 22 with:

```bash
docker run --rm -it -u devbox -e NODE_VERSION=22 -v "$PWD:/workspace" devbox:latest
```

### Persist AI tool data

Create the AI tool configuration file and persistent volumes for the `devbox` user:

```bash
printf '{}\n' > prototype/node/data/.claude.json
docker volume create devbox-claude
docker volume create devbox-codex
docker volume create devbox-agy
docker volume create devbox-omp
docker run --rm -it \
  -u devbox \
  -e TERM="xterm-256color" \
  -v "$PWD:/workspace" \
  -v devbox-claude:/home/devbox/.claude \
  -v ./prototype/node/data/.claude.json:/home/devbox/.claude.json \
  -v devbox-codex:/home/devbox/.codex \
  -v devbox-agy:/home/devbox/.gemini \
  -v devbox-omp:/home/devbox/.omp \
  devbox:latest
```

### WSL audio passthrough

Pass through the WSL audio interface:

```bash
docker run --rm -it \
  -u devbox \
  -e PULSE_SERVER=unix:/tmp/pulse-socket \
  -v "$PWD:/workspace" \
  -v /mnt/wslg/runtime-dir/pulse/native:/tmp/pulse-socket \
  devbox:latest
```
