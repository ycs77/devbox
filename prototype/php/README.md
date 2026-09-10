# Devbox PHP Docker Prototype

## Docker Compose

Before the first start, create the local Claude Code configuration file:

```bash
mkdir -p prototype/php/data
printf '{}\n' > prototype/php/data/.claude.json
```

Build the devbox image with:

```bash
docker build \
  --file prototype/php/Dockerfile \
  --build-arg USER_ID=$(id -u) \
  --build-arg GROUP_ID=$(id -g) \
  --tag devbox-php:latest .
```

Start the devbox container with:

```bash
docker compose -f prototype/php/compose.yaml up -d
docker compose -f prototype/php/compose.yaml exec -it -u devbox devbox bash
docker compose -f prototype/php/compose.yaml down
```

Or just run the devbox container with:

```bash
docker compose -f prototype/php/compose.yaml run --rm -it -u devbox devbox bash
```
