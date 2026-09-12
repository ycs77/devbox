import { PACKAGED_NODE_RECIPES, type NodeRuntimeRecipe } from '../../catalog/index.js'

export interface NodeWorkspaceContribution {
  readonly buildNodeRuntimeRoot: string | undefined
  readonly runtimeInstallations: readonly string[]
  readonly sandboxUserSetup: readonly string[]
  readonly entrypointSetup: readonly string[]
}

export function createNodeWorkspaceContribution(
  configuredReleaseLines: readonly string[],
): NodeWorkspaceContribution {
  const runtimes = configuredReleaseLines.map(releaseLine => PACKAGED_NODE_RECIPES[releaseLine])
  const buildRuntime = selectBuildNodeRuntime(runtimes)

  return {
    buildNodeRuntimeRoot: buildRuntime?.runtimeRoot,
    runtimeInstallations: runtimes.flatMap(renderNodeRuntimeStage),
    sandboxUserSetup:
      buildRuntime === undefined
        ? []
        : [
            '# Configure pnpm for the non-root Sandbox user',
            'RUN mkdir -p /home/devbox/.config/pnpm /home/devbox/.pnpm-store \\',
            "    && printf 'storeDir: /home/devbox/.pnpm-store\\n' > /home/devbox/.config/pnpm/config.yaml \\",
            '    && chown devbox:devbox /home/devbox/.config/pnpm/config.yaml',
            '',
          ],
    entrypointSetup: renderNodeEntrypointSetup(runtimes),
  }
}

function selectBuildNodeRuntime(
  runtimes: readonly NodeRuntimeRecipe[],
): NodeRuntimeRecipe | undefined {
  let buildRuntime: NodeRuntimeRecipe | undefined
  for (const runtime of runtimes) {
    if (
      buildRuntime === undefined ||
      Number.parseFloat(runtime.releaseLine) > Number.parseFloat(buildRuntime.releaseLine)
    ) {
      buildRuntime = runtime
    }
  }
  return buildRuntime
}

function renderNodeEntrypointSetup(runtimes: readonly NodeRuntimeRecipe[]): string[] {
  if (runtimes.length === 0) {
    return []
  }

  return [
    '# Set the Node.js release line to use',
    'NODE_VERSION="${NODE_VERSION:-}"',
    'if [ -n "$NODE_VERSION" ]; then',
    '  case "$NODE_VERSION" in',
    '    *[!0-9]*)',
    '      echo "NODE_VERSION must be a numeric release line: $NODE_VERSION" >&2',
    '      exit 1',
    '      ;;',
    '  esac',
    '',
    '  NODE_RUNTIME_ROOT="/opt/devbox/runtimes/node/$NODE_VERSION"',
    '  if [ ! -x "$NODE_RUNTIME_ROOT/bin/node" ]; then',
    '    echo "Node.js release line $NODE_VERSION is not installed." >&2',
    '    exit 1',
    '  fi',
    '',
    '  if ! grep -q "# Devbox" /etc/bash.bashrc; then',
    '    printf "\\n# Devbox\\nexport PATH=\\"$NODE_RUNTIME_ROOT/bin:\\$PATH\\"\\n" >> /etc/bash.bashrc',
    '  fi',
    '',
    '  export PATH="$NODE_RUNTIME_ROOT/bin:$PATH"',
    'fi',
    '',
  ]
}

function renderNodeRuntimeStage(recipe: NodeRuntimeRecipe): string[] {
  const keys = recipe.trustedReleaseKeys.map(key => `      ${key}`).join(' \\\n')

  return [
    `# Install Node.js ${recipe.releaseLine}`,
    'RUN ARCH= OPENSSL_ARCH= && dpkgArch="$(dpkg --print-architecture)" \\',
    '    && case "${dpkgArch##*-}" in \\',
    "      amd64) ARCH='x64' OPENSSL_ARCH='linux-x86_64';; \\",
    "      ppc64el) ARCH='ppc64le' OPENSSL_ARCH='linux-ppc64le';; \\",
    "      s390x) ARCH='s390x' OPENSSL_ARCH='linux*-s390x';; \\",
    "      arm64) ARCH='arm64' OPENSSL_ARCH='linux-aarch64';; \\",
    '      *) echo "unsupported architecture"; exit 1 ;; \\',
    '    esac \\',
    '    && set -eux \\',
    `    && NODE_RUNTIME_VERSION=${recipe.version} \\`,
    `    && NODE_RUNTIME_ROOT=${recipe.runtimeRoot} \\`,
    '    && mkdir -p "$NODE_RUNTIME_ROOT" /tmp/node-source \\',
    '    && cd /tmp/node-source \\',
    '    && export GNUPGHOME="$(mktemp -d)" \\',
    '    && for key in \\',
    `${keys} \\`,
    '    ; do \\',
    '      { gpg --batch --no-options --keyserver hkps://keys.openpgp.org --recv-keys "$key" && gpg --batch --no-options --fingerprint "$key"; } || \\',
    '      { gpg --batch --no-options --keyserver keyserver.ubuntu.com --recv-keys "$key" && gpg --batch --no-options --fingerprint "$key"; }; \\',
    '    done \\',
    '    && archive="node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" \\',
    `    && curl -fsSLO --compressed "${recipe.distributionBaseUrl}/v\${NODE_RUNTIME_VERSION}/node-v\${NODE_RUNTIME_VERSION}-linux-\${ARCH}.tar.xz" \\`,
    `    && curl -fsSLO --compressed "${recipe.distributionBaseUrl}/v\${NODE_RUNTIME_VERSION}/SHASUMS256.txt.asc" \\`,
    '    && gpg --batch --no-options --decrypt --output SHASUMS256.txt SHASUMS256.txt.asc \\',
    '    && gpgconf --kill all \\',
    '    && rm -rf "$GNUPGHOME" \\',
    '    && grep " node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz\\$" SHASUMS256.txt | sha256sum -c - \\',
    '    && tar -xJf "node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" -C "$NODE_RUNTIME_ROOT" --strip-components=1 --no-same-owner \\',
    '    && rm "node-v${NODE_RUNTIME_VERSION}-linux-${ARCH}.tar.xz" SHASUMS256.txt.asc SHASUMS256.txt \\',
    '    && find "$NODE_RUNTIME_ROOT/include/node/openssl/archs" -mindepth 1 -maxdepth 1 ! -name "$OPENSSL_ARCH" -exec rm -rf {} \\; \\',
    '    && apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false \\',
    '    && export PATH="$NODE_RUNTIME_ROOT/bin:$PATH" \\',
    '    && npm install -g npm \\',
    '    && npm uninstall -g corepack \\',
    '    && npm install -g yarn pnpm @antfu/ni --allow-scripts=pnpm,yarn \\',
    '    && "$NODE_RUNTIME_ROOT/bin/node" --version \\',
    '    && "$NODE_RUNTIME_ROOT/bin/npm" --version \\',
    '    && rm -rf /tmp/node-source',
    '',
  ]
}
