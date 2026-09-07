# PROTOTYPE: validate the one-stage Base plus direct Node archive recipe.
# The generated Build Dockerfile will replace these fixed values with lock inputs.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC
ENV LANG=C.UTF-8

RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Install the Base profile packages and build tools
RUN set -eux \
    && apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      wget \
      git \
      supervisor \
      openssh-client \
      zip \
      unzip \
      jq \
      less \
      vim \
      ripgrep \
      fd-find \
      procps \
      lsof \
      iproute2 \
      dnsutils \
      netcat-openbsd \
      rsync \
      tree \
      tzdata \
      bubblewrap \
      build-essential \
      python3 \
      python-is-python3 \
      pkg-config \
      gnupg \
      dirmngr \
      xz-utils \
      pulseaudio-utils \
      sudo \
      gosu \
    && apt-get -y autoremove \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create the devbox user and group
RUN userdel -r ubuntu \
    && groupadd -f -g 1000 devbox \
    && useradd -m -s /bin/bash -N -g 1000 -u 1000 devbox \
    && echo "devbox ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/devbox \
    && chmod 0440 /etc/sudoers.d/devbox

WORKDIR /workspace
USER devbox

# Install Claude Code
RUN mkdir -p /home/devbox/.claude \
    && echo '{}' > /home/devbox/.claude.json \
    && curl -fsSL https://claude.ai/install.sh | bash

# Install Codex CLI
RUN mkdir -p /home/devbox/.codex \
    && curl -fsSL https://chatgpt.com/codex/install.sh | sh

# Install Antigravity CLI
RUN mkdir -p /home/devbox/.gemini \
    && curl -fsSL https://antigravity.google/cli/install.sh | bash

# Install OMP
RUN mkdir -p /home/devbox/.omp \
    && curl -fsSL https://omp.sh/install | sh

# Set the PATH to include AI tools
ENV PATH="/home/devbox/.local/bin:${PATH}"

USER root

# Copy dotfiles
COPY prototype/php/.bash_aliases /home/devbox/.bash_aliases
COPY prototype/php/.gitconfig /home/devbox/.gitconfig
RUN chown devbox:devbox /home/devbox/.bash_aliases \
    && chown devbox:devbox /home/devbox/.gitconfig

# Copy AI dotfiles
COPY prototype/php/.claude/settings.json /home/devbox/.claude/settings.json
COPY prototype/php/.omp/agent/config.yml /home/devbox/.omp/agent/config.yml
RUN chown devbox:devbox /home/devbox/.claude/settings.json \
    && chown devbox:devbox /home/devbox/.omp/agent \
    && chown devbox:devbox /home/devbox/.omp/agent/config.yml

# Install Agent Notification Plugins
USER devbox
RUN set -eux \
    && claude plugin marketplace add ycs77/claude-code-notifications \
    && claude plugin install notification-basic-wsl@ycs77-notifications \
    && codex plugin marketplace add ycs77/codex-notifications \
    && codex plugin add notification-basic-wsl@ycs77-notifications \
    && omp plugin marketplace add ycs77/omp-notifications \
    && omp plugin install notification-basic@ycs77-notifications
USER root

COPY prototype/php/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY prototype/php/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
