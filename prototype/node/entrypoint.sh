#!/bin/sh
set -eu

# Set the Node.js release line to use
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

# Link shared Agent Skills
if [ ! -L "/home/devbox/.gemini/skills" ]; then
  ln -sfn /home/devbox/.agents/skills /home/devbox/.gemini/skills
  chown -h devbox:devbox /home/devbox/.gemini/skills
fi

if [ $# -gt 0 ]; then
  exec gosu devbox "$@"
else
  exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
fi
