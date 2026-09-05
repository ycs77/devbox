import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { defineConfig, type TsdownPlugin } from 'tsdown'

const WORKSPACE_IMAGE_DEFAULTS_DIRECTORY = resolve('src/workspace/image-defaults')
const RAW_WORKSPACE_IMAGE_DEFAULT_PREFIX = '\0devbox-workspace-image-default:'

// Embed Workspace image defaults to avoid a runtime dependency on packaged asset paths.
// Implements build-time `?raw` imports for the default text files.
const rawWorkspaceImageDefaultPlugin: TsdownPlugin = {
  name: 'raw-workspace-image-default',
  resolveId(source, importer) {
    if (!source.endsWith('?raw') || importer === undefined) {
      return null
    }

    const assetPath = resolve(dirname(importer), source.slice(0, -'?raw'.length))
    const pathWithinDefaults = relative(WORKSPACE_IMAGE_DEFAULTS_DIRECTORY, assetPath)
    if (
      pathWithinDefaults.length === 0 ||
      pathWithinDefaults === '..' ||
      pathWithinDefaults.startsWith(`..${sep}`) ||
      isAbsolute(pathWithinDefaults)
    ) {
      return null
    }
    return `${RAW_WORKSPACE_IMAGE_DEFAULT_PREFIX}${pathWithinDefaults}.mjs`
  },
  async load(id) {
    if (!id.startsWith(RAW_WORKSPACE_IMAGE_DEFAULT_PREFIX)) {
      return null
    }
    const relativePath = id.slice(RAW_WORKSPACE_IMAGE_DEFAULT_PREFIX.length, -'.mjs'.length)
    const content = await readFile(
      resolve(WORKSPACE_IMAGE_DEFAULTS_DIRECTORY, relativePath),
      'utf8',
    )
    return `export default ${JSON.stringify(content)}`
  },
}

export default defineConfig({
  entry: ['src/cli.ts'],
  plugins: [rawWorkspaceImageDefaultPlugin],
})
