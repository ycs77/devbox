#!/bin/sh
set -eu

NODE_VERSION="${NODE_VERSION:-}"
case "$NODE_VERSION" in
  ''|*[!0-9]*)
    echo "NODE_VERSION must be a numeric release line: $NODE_VERSION" >&2
    exit 1
    ;;
esac

NODE_RUNTIME_ROOT="/opt/devbox/runtimes/node/$NODE_VERSION"
if [ ! -x "$NODE_RUNTIME_ROOT/bin/node" ]; then
  echo "Node.js release line $NODE_VERSION is not installed." >&2
  exit 1
fi

export NODE_RUNTIME_ROOT
export PATH="$NODE_RUNTIME_ROOT/bin:$PATH"
exec "$@"
