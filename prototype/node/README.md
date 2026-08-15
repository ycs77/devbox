# Devbox Node Docker Prototype

Enter the prototype image with the default Node.js 24 runtime:

```bash
docker run --rm -it -u devbox -v "$PWD:/workspace" devbox:latest
```

Switch to Node.js 22 with:

```bash
docker run --rm -it -u devbox -e NODE_VERSION=22 -v "$PWD:/workspace" devbox:latest
```

Create the some AI directory for the devbox user with:

```bash
mkdir -p ./prototype/node/data/claude && echo "{}" > ./prototype/node/data/.claude.json
docker volume create --name devbox-codex
docker volume create --name devbox-omp
docker run --rm -it -u devbox -v "$PWD:/workspace" -v ./prototype/node/data/claude:/home/devbox/.claude -v ./prototype/node/data/.claude.json:/home/devbox/.claude.json -v devbox-codex:/home/devbox/.codex -v devbox-omp:/home/devbox/.omp devbox:latest
```
