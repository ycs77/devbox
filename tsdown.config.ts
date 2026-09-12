import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { defineConfig, type TsdownPlugin } from 'tsdown'

const IMAGE_DEFAULT_DIRECTORIES = [
  resolve('src/agent/image-defaults'),
  resolve('src/workspace/image-defaults'),
]
const RAW_IMAGE_DEFAULT_PREFIX = '\0devbox-image-default:'

// Embed image defaults to avoid a runtime dependency on packaged asset paths.
// Implements build-time `?raw` imports for the default text files.
const rawImageDefaultPlugin: TsdownPlugin = {
  name: 'raw-image-default',
  resolveId(source, importer) {
    if (!source.endsWith('?raw') || importer === undefined) {
      return null
    }

    const assetPath = resolve(dirname(importer), source.slice(0, -'?raw'.length))
    const isImageDefault = IMAGE_DEFAULT_DIRECTORIES.some(directory => {
      const pathWithinDefaults = relative(directory, assetPath)
      return (
        pathWithinDefaults.length > 0 &&
        pathWithinDefaults !== '..' &&
        !pathWithinDefaults.startsWith(`..${sep}`) &&
        !isAbsolute(pathWithinDefaults)
      )
    })
    return isImageDefault ? `${RAW_IMAGE_DEFAULT_PREFIX}${assetPath}.mjs` : null
  },
  async load(id) {
    if (!id.startsWith(RAW_IMAGE_DEFAULT_PREFIX)) {
      return null
    }
    const assetPath = id.slice(RAW_IMAGE_DEFAULT_PREFIX.length, -'.mjs'.length)
    const content = await readFile(assetPath, 'utf8')
    return `export default ${JSON.stringify(content)}`
  },
}

export default defineConfig({
  entry: ['src/cli.ts'],
  plugins: [rawImageDefaultPlugin],
})
