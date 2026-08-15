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
ln -sfn ../.agents/skills /home/devbox/.claude/skills
ln -sfn ../../.agents/skills /home/devbox/.gemini/antigravity-cli/skills

# Install Agent Notification Plugins
if ! claude plugin marketplace list | grep -q 'ycs77-notifications'; then
  claude plugin marketplace add ycs77/claude-code-notifications
  claude plugin install notification-basic-wsl@ycs77-notifications
fi
if ! codex plugin marketplace list | grep -q 'ycs77-notifications'; then
  codex plugin marketplace add ycs77/codex-notifications
  codex plugin add notification-basic-wsl@ycs77-notifications
fi
if ! omp plugin marketplace list | grep -q 'ycs77-notifications'; then
  omp plugin marketplace add ycs77/omp-notifications
  omp plugin install notification-basic@ycs77-notifications
fi

exec "$@"
