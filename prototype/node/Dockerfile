# PROTOTYPE: validate the one-stage Base plus direct Node archive recipe.
# The generated Build Dockerfile will replace these fixed values with lock inputs.
FROM ubuntu:24.04@sha256:561618e2c15bf2397621dd04f96926663a3b5616c189cf7e38db7e82f5c538ea

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC
ENV LANG=C.UTF-8

ENV NODE_VERSION=24

RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Create the fixed Sandbox user and group.
RUN userdel --remove ubuntu
RUN groupadd --force --gid 1000 devbox
RUN useradd --create-home --shell /bin/bash --no-user-group --gid 1000 --uid 1000 devbox

# Install the Base profile packages and build tools.
RUN set -eux \
    && apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends ca-certificates \
    && sed -i 's|^URIs: http://|URIs: https://|' /etc/apt/sources.list.d/ubuntu.sources \
    && if [ -f /etc/apt/sources.list ]; then \
      sed -i 's|^deb http://|deb https://|' /etc/apt/sources.list; \
    fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      openssh-client \
      zip \
      unzip \
      jq \
      less \
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
      build-essential \
      python3 \
      python-is-python3 \
      pkg-config \
      gnupg \
      dirmngr \
      xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Install and verify Node.js 22.
# Keep each release-line recipe in one contiguous block for Dockerfile generation.
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
    && NODE_ARCHIVE_URL="https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}/node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" \
    && NODE_CHECKSUMS_URL="https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}/SHASUMS256.txt.asc" \
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
    && archive="node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" \
    && curl -fsSL --retry 3 -o "$archive" "$NODE_ARCHIVE_URL" \
    && curl -fsSL --retry 3 -o SHASUMS256.txt.asc "$NODE_CHECKSUMS_URL" \
    && gpg --batch --no-options --decrypt --output SHASUMS256.txt SHASUMS256.txt.asc \
    && gpgconf --kill all \
    && rm -rf "$GNUPGHOME" \
    && awk -v archive="$archive" \
      '$2 == archive { print; found = 1; exit } END { if (!found) exit 1 }' \
      SHASUMS256.txt > "$archive.sha256" \
    && sha256sum --check "$archive.sha256" \
    && tar --extract --xz --file "$archive" --directory "$NODE_RUNTIME_ROOT" \
      --strip-components=1 --no-same-owner \
    && rm "$archive" SHASUMS256.txt.asc SHASUMS256.txt "$archive.sha256" \
    # Remove unused OpenSSL headers to save ~34MB. See this NodeJS issue: https://github.com/nodejs/node/issues/46451
    && find "$NODE_RUNTIME_ROOT/include/node/openssl/archs" -mindepth 1 -maxdepth 1 ! -name "$OPENSSL_ARCH" -exec rm -rf {} \; \
    && apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false \
    && export PATH="$NODE_RUNTIME_ROOT/bin:$PATH" \
    && "$NODE_RUNTIME_ROOT/bin/node" --version \
    && "$NODE_RUNTIME_ROOT/bin/npm" --version \
    && rm -rf /tmp/node-source

# Install and verify Node.js 24.
# Keep each release-line recipe in one contiguous block for Dockerfile generation.
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
    && NODE_ARCHIVE_URL="https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}/node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" \
    && NODE_CHECKSUMS_URL="https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}/SHASUMS256.txt.asc" \
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
    && archive="node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" \
    && curl -fsSL --retry 3 -o "$archive" "$NODE_ARCHIVE_URL" \
    && curl -fsSL --retry 3 -o SHASUMS256.txt.asc "$NODE_CHECKSUMS_URL" \
    && gpg --batch --no-options --decrypt --output SHASUMS256.txt SHASUMS256.txt.asc \
    && gpgconf --kill all \
    && rm -rf "$GNUPGHOME" \
    && awk -v archive="$archive" \
      '$2 == archive { print; found = 1; exit } END { if (!found) exit 1 }' \
      SHASUMS256.txt > "$archive.sha256" \
    && sha256sum --check "$archive.sha256" \
    && tar --extract --xz --file "$archive" --directory "$NODE_RUNTIME_ROOT" \
      --strip-components=1 --no-same-owner \
    && rm "$archive" SHASUMS256.txt.asc SHASUMS256.txt "$archive.sha256" \
    # Remove unused OpenSSL headers to save ~34MB. See this NodeJS issue: https://github.com/nodejs/node/issues/46451
    && find "$NODE_RUNTIME_ROOT/include/node/openssl/archs" -mindepth 1 -maxdepth 1 ! -name "$OPENSSL_ARCH" -exec rm -rf {} \; \
    && apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false \
    && export PATH="$NODE_RUNTIME_ROOT/bin:$PATH" \
    && "$NODE_RUNTIME_ROOT/bin/node" --version \
    && "$NODE_RUNTIME_ROOT/bin/npm" --version \
    && rm -rf /tmp/node-source

# Select an installed Node.js runtime at container startup.
COPY prototype/node/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
WORKDIR /workspace
CMD ["node", "--version"]
