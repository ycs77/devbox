# PROTOTYPE: validate the one-stage Base plus direct Node archive recipe.
# The generated Build Dockerfile will replace these fixed values with lock inputs.
FROM ubuntu:24.04

ARG USER_ID
ARG GROUP_ID

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC
ENV LANG=C.UTF-8
ENV TERM=xterm-256color
ENV EDITOR=vim
ENV VISUAL=vim

RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

RUN echo "Acquire::http::Pipeline-Depth 0;" > /etc/apt/apt.conf.d/99custom && \
    echo "Acquire::http::No-Cache true;" >> /etc/apt/apt.conf.d/99custom && \
    echo "Acquire::BrokenProxy    true;" >> /etc/apt/apt.conf.d/99custom

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
    && groupadd -g "$GROUP_ID" devbox \
    && useradd -m -s /bin/bash -N -g "$GROUP_ID" -u "$USER_ID" devbox \
    && echo "devbox ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/devbox \
    && chmod 0440 /etc/sudoers.d/devbox

# Install Node.js 22
RUN ARCH= OPENSSL_ARCH= && dpkgArch="$(dpkg --print-architecture)" \
    && case "${dpkgArch##*-}" in \
      amd64) ARCH='x64' OPENSSL_ARCH='linux-x86_64';; \
      ppc64el) ARCH='ppc64le' OPENSSL_ARCH='linux-ppc64le';; \
      s390x) ARCH='s390x' OPENSSL_ARCH='linux*-s390x';; \
      arm64) ARCH='arm64' OPENSSL_ARCH='linux-aarch64';; \
      *) echo "unsupported architecture"; exit 1 ;; \
    esac \
    && set -eux \
    && NODE_RUNTIME_VERSION=22.23.2 \
    && NODE_RUNTIME_ROOT=/opt/devbox/runtimes/node/22 \
    && mkdir -p "$NODE_RUNTIME_ROOT" /tmp/node-source \
    && cd /tmp/node-source \
    # use pre-existing gpg directory
    && export GNUPGHOME="$(mktemp -d)" \
    # gpg keys listed at https://github.com/nodejs/node#release-keys
    && for key in \
      5BE8A3F6C8A5C01D106C0AD820B1A390B168D356 \
      DD792F5973C6DE52C432CBDAC77ABFA00DDBF2B7 \
      CC68F5A3106FF448322E48ED27F5E38D5B0A215F \
      8FCCA13FEF1D0C2E91008E09770F7A9A5AE15600 \
      890C08DB8579162FEE0DF9DB8BEAB4DFCF555EF4 \
      C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C \
      108F52B48DB57BB0CC439B2997B01419BD92F80A \
      A363A499291CBBC940DD62E41F10027AF002F8B0 \
      655F3B5C1FB3FA8D1A0CA6BDE4A7D232B936D2FD \
    ; do \
      { gpg --batch --no-options --keyserver hkps://keys.openpgp.org --recv-keys "$key" && gpg --batch --no-options --fingerprint "$key"; } || \
      { gpg --batch --no-options --keyserver keyserver.ubuntu.com --recv-keys "$key" && gpg --batch --no-options --fingerprint "$key"; }; \
    done \
    && curl -fsSLO --compressed "https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}/node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" \
    && curl -fsSLO --compressed "https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}/SHASUMS256.txt.asc" \
    && gpg --batch --no-options --decrypt --output SHASUMS256.txt SHASUMS256.txt.asc \
    && gpgconf --kill all \
    && rm -rf "$GNUPGHOME" \
    && grep " node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz\$" SHASUMS256.txt | sha256sum -c - \
    && tar -xJf "node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" -C "$NODE_RUNTIME_ROOT" --strip-components=1 --no-same-owner \
    && rm "node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" SHASUMS256.txt.asc SHASUMS256.txt \
    # Remove unused OpenSSL headers to save ~34MB. See this NodeJS issue: https://github.com/nodejs/node/issues/46451
    && find "$NODE_RUNTIME_ROOT/include/node/openssl/archs" -mindepth 1 -maxdepth 1 ! -name "$OPENSSL_ARCH" -exec rm -rf {} \; \
    && apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false \
    && export PATH="$NODE_RUNTIME_ROOT/bin:$PATH" \
    && npm install -g npm \
    && npm uninstall -g corepack \
    && npm install -g yarn pnpm @antfu/ni --allow-scripts=pnpm,yarn \
    && "$NODE_RUNTIME_ROOT/bin/node" --version \
    && "$NODE_RUNTIME_ROOT/bin/npm" --version \
    && rm -rf /tmp/node-source

# Install Node.js 24
RUN ARCH= OPENSSL_ARCH= && dpkgArch="$(dpkg --print-architecture)" \
    && case "${dpkgArch##*-}" in \
      amd64) ARCH='x64' OPENSSL_ARCH='linux-x86_64';; \
      ppc64el) ARCH='ppc64le' OPENSSL_ARCH='linux-ppc64le';; \
      s390x) ARCH='s390x' OPENSSL_ARCH='linux*-s390x';; \
      arm64) ARCH='arm64' OPENSSL_ARCH='linux-aarch64';; \
      *) echo "unsupported architecture"; exit 1 ;; \
    esac \
    && set -eux \
    && NODE_RUNTIME_VERSION=24.19.0 \
    && NODE_RUNTIME_ROOT=/opt/devbox/runtimes/node/24 \
    && mkdir -p "$NODE_RUNTIME_ROOT" /tmp/node-source \
    && cd /tmp/node-source \
    # use pre-existing gpg directory
    && export GNUPGHOME="$(mktemp -d)" \
    # gpg keys listed at https://github.com/nodejs/node#release-keys
    && for key in \
      5BE8A3F6C8A5C01D106C0AD820B1A390B168D356 \
      DD792F5973C6DE52C432CBDAC77ABFA00DDBF2B7 \
      CC68F5A3106FF448322E48ED27F5E38D5B0A215F \
      8FCCA13FEF1D0C2E91008E09770F7A9A5AE15600 \
      890C08DB8579162FEE0DF9DB8BEAB4DFCF555EF4 \
      C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C \
      108F52B48DB57BB0CC439B2997B01419BD92F80A \
      A363A499291CBBC940DD62E41F10027AF002F8B0 \
      655F3B5C1FB3FA8D1A0CA6BDE4A7D232B936D2FD \
    ; do \
      { gpg --batch --no-options --keyserver hkps://keys.openpgp.org --recv-keys "$key" && gpg --batch --no-options --fingerprint "$key"; } || \
      { gpg --batch --no-options --keyserver keyserver.ubuntu.com --recv-keys "$key" && gpg --batch --no-options --fingerprint "$key"; }; \
    done \
    && curl -fsSLO --compressed "https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}/node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" \
    && curl -fsSLO --compressed "https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}/SHASUMS256.txt.asc" \
    && gpg --batch --no-options --decrypt --output SHASUMS256.txt SHASUMS256.txt.asc \
    && gpgconf --kill all \
    && rm -rf "$GNUPGHOME" \
    && grep " node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz\$" SHASUMS256.txt | sha256sum -c - \
    && tar -xJf "node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" -C "$NODE_RUNTIME_ROOT" --strip-components=1 --no-same-owner \
    && rm "node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" SHASUMS256.txt.asc SHASUMS256.txt \
    # Remove unused OpenSSL headers to save ~34MB. See this NodeJS issue: https://github.com/nodejs/node/issues/46451
    && find "$NODE_RUNTIME_ROOT/include/node/openssl/archs" -mindepth 1 -maxdepth 1 ! -name "$OPENSSL_ARCH" -exec rm -rf {} \; \
    && apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false \
    && export PATH="$NODE_RUNTIME_ROOT/bin:$PATH" \
    && npm install -g npm \
    && npm uninstall -g corepack \
    && npm install -g yarn pnpm @antfu/ni --allow-scripts=pnpm,yarn \
    && "$NODE_RUNTIME_ROOT/bin/node" --version \
    && "$NODE_RUNTIME_ROOT/bin/npm" --version \
    && rm -rf /tmp/node-source

WORKDIR /workspace
USER devbox

# Configure pnpm for the non-root Sandbox user
RUN mkdir -p /home/devbox/.config/pnpm /home/devbox/.pnpm-store \
    && printf 'storeDir: /home/devbox/.pnpm-store\n' > /home/devbox/.config/pnpm/config.yaml \
    && chown devbox:devbox /home/devbox/.config/pnpm/config.yaml

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

# Install Agent Skills
RUN set -eux \
    && mkdir -p /home/devbox/.agents/skills \
    && export PATH="/opt/devbox/runtimes/node/24/bin:$PATH" \
    && npx -y skills add ycs77/skills -g -a claude-code -a codex -s '*' -y

USER root

# Copy dotfiles
COPY prototype/node/.bash_aliases /home/devbox/.bash_aliases
COPY prototype/node/.gitconfig /home/devbox/.gitconfig
RUN chown devbox:devbox /home/devbox/.bash_aliases \
    && chown devbox:devbox /home/devbox/.gitconfig

# Copy AI dotfiles
COPY prototype/node/.claude/settings.json /home/devbox/.claude/settings.json
COPY prototype/node/.claude/CLAUDE.md /home/devbox/.claude/CLAUDE.md
COPY prototype/node/.codex/AGENTS.md /home/devbox/.codex/AGENTS.md
COPY prototype/node/.gemini/GEMINI.md /home/devbox/.gemini/GEMINI.md
COPY prototype/node/.omp/agent/config.yml /home/devbox/.omp/agent/config.yml
COPY prototype/node/.omp/agent/AGENTS.md /home/devbox/.omp/agent/AGENTS.md
RUN chown devbox:devbox /home/devbox/.claude/settings.json \
    && chown devbox:devbox /home/devbox/.claude/CLAUDE.md \
    && chown devbox:devbox /home/devbox/.codex/AGENTS.md \
    && chown devbox:devbox /home/devbox/.gemini/GEMINI.md \
    && chown devbox:devbox /home/devbox/.omp/agent \
    && chown devbox:devbox /home/devbox/.omp/agent/config.yml \
    && chown devbox:devbox /home/devbox/.omp/agent/AGENTS.md

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

COPY prototype/node/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY prototype/node/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
