import { execFile as execFileCallback } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { stringify } from 'yaml'
import {
  DEFAULT_RUNTIME_CATALOG,
  normalizeCatalog,
  parseGlobalConfiguration,
  parseLocalConfiguration,
  type GlobalConfiguration,
  type LocalConfiguration,
  type RuntimeCatalog,
} from './configuration.js'
import { PlatformLockInterruptedError, withPlatformLock } from './platform-coordination.js'
import { devboxPaths } from './project.js'
import { parseProjectRegistry, type ProjectRegistry } from './registry.js'
import { failure, success, type Result } from './result.js'

const execFile = promisify(execFileCallback)

export const PLATFORM_TARGET = 'linux/amd64'
export const PLATFORM_VERSION = 1
export const UBUNTU_BASE_IMAGE = 'ubuntu:24.04'
export const UBUNTU_SNAPSHOT = '20260804T000000Z'
export const CURATED_BASE_PACKAGES = [
  'ca-certificates',
  'curl',
  'git',
  'openssh-client',
  'zip',
  'unzip',
  'jq',
  'less',
  'ripgrep',
  'fd-find',
  'procps',
  'lsof',
  'iproute2',
  'dnsutils',
  'netcat-openbsd',
  'rsync',
  'tree',
  'tzdata',
  'build-essential',
  'python3',
  'python-is-python3',
  'pkg-config',
] as const

const UBUNTU_TAG_METADATA_URL = 'https://hub.docker.com/v2/repositories/library/ubuntu/tags/24.04'
const NODE_RELEASE_INDEX_URL = 'https://nodejs.org/dist/index.json'
const NODE_CHECKSUMS_URL = (revision: string) =>
  `https://nodejs.org/dist/v${revision}/SHASUMS256.txt.asc`
const NODE_ARCHIVE_URL = (revision: string) =>
  `https://nodejs.org/dist/v${revision}/node-v${revision}-linux-x64.tar.gz`
const NODE_RELEASE_KEYS = `-----BEGIN PGP PUBLIC KEY BLOCK-----

mDMEaGA63BYJKwYBBAHaRw8BAQdAo/yU+MutacFmmn0CEX495goNrBxR24235XLM
cvHYjfq0L0FudG9pbmUgZHUgSGFtZWwgPGR1aGFtZWxhbnRvaW5lMTk5NUBnbWFp
bC5jb20+iI4EExYKADYWIQRb6KP2yKXAHRBsCtggsaOQsWjTVgUCaGA63AIbAwQL
CQgHBBUKCQgFFgIDAQACHgUCF4AACgkQILGjkLFo01afgwEA/sLHqsj7ml2vyDoT
KDPE8n9a80ZOh14OfnlOe0cCZA8BAMEOOk7QFI69DIlV1nMiqcFCqQFoSzBU2LkI
R17p/j4NtDNBbnRvaW5lIGR1IEhhbWVsIDxhbnRvaW5lLmR1aGFtZWxAcGxhdGZv
cm1hdGljLmRldj6IjgQTFgoANhYhBFvoo/bIpcAdEGwK2CCxo5CxaNNWBQJpsCMx
AhsDBAsJCAcEFQoJCAUWAgMBAAIeAQIXgAAKCRAgsaOQsWjTVr/sAPwIBsG8g6ND
zoNRTX1wPKBvfZg1NP7tYCyM5sxQfrpuLAEA05AhG4xBILfhL/f0pqR5jXfxg6gz
T6WfeVeS6zeHZwe4OARoYDrcEgorBgEEAZdVAQUBAQdAQVmtih8AO3ryBQMR/22x
WHVKLjAbCiH2cMxNH+iy1RQDAQgHiHgEGBYKACAWIQRb6KP2yKXAHRBsCtggsaOQ
sWjTVgUCaGA63AIbDAAKCRAgsaOQsWjTVu8oAP9Bc+QY+9FikX3YvMgWAqiDlVOy
o0y6UIZGBMSQlF80wAD/d34LqtVIVe9oe5NO3xA75+6Ew8tGeAjUq/ovagr5dAU=
=JsVv
-----END PGP PUBLIC KEY BLOCK-----

-----BEGIN PGP PUBLIC KEY BLOCK-----

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
ZWf0a3VP6Gco5bmDPhvGoLEs9Vw5
=57kS
-----END PGP PUBLIC KEY BLOCK-----`

export interface BaseLock {
  readonly image: typeof UBUNTU_BASE_IMAGE
  readonly digest: string
  readonly apt: {
    readonly snapshot: string
    readonly packages: readonly string[]
  }
}

export interface NodeRuntimeLock {
  readonly revision: string
  readonly archive: {
    readonly url: string
    readonly sha256: string
  }
  readonly signedChecksums: {
    readonly url: string
    readonly signer: string
  }
}

export interface PlatformLock {
  readonly version: typeof PLATFORM_VERSION
  readonly platform: typeof PLATFORM_TARGET
  readonly base: BaseLock
  readonly runtimes: Readonly<{
    readonly node?: Readonly<Record<string, NodeRuntimeLock>>
  }>
}

export interface PlatformUpdateResult {
  readonly changed: boolean
  readonly lockPath: string
  readonly runtimes: Readonly<Record<string, readonly string[]>>
}

export interface PlatformResolver {
  readonly resolveBase: (input: {
    readonly platform: typeof PLATFORM_TARGET
    readonly signal?: AbortSignal
  }) => Promise<Result<BaseLock>>
  readonly resolveNode: (input: {
    readonly releaseLine: string
    readonly platform: typeof PLATFORM_TARGET
    readonly signal?: AbortSignal
  }) => Promise<Result<NodeRuntimeLock>>
}

export interface UpdatePlatformInput {
  readonly devboxHome?: string
  readonly signal?: AbortSignal
  readonly catalog?: RuntimeCatalog
  readonly resolver?: PlatformResolver
}

export const DEFAULT_PLATFORM_RESOLVER: PlatformResolver = {
  resolveBase: ({ signal }) => resolveUbuntuBase(signal),
  resolveNode: ({ releaseLine, signal }) => resolveNodeRelease(releaseLine, signal),
}

async function resolveUbuntuBase(signal?: AbortSignal): Promise<Result<BaseLock>> {
  const metadata = await fetchJson(
    UBUNTU_TAG_METADATA_URL,
    signal,
    'base-resolution-failed',
    'the official Ubuntu Base metadata',
  )
  if (!metadata.ok) {
    return metadata
  }
  if (
    !isRecord(metadata.value) ||
    typeof metadata.value.digest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(metadata.value.digest)
  ) {
    return resolutionFailure(
      'base-resolution-failed',
      'The official Ubuntu 24.04 metadata did not contain a valid digest.',
    )
  }
  return success({
    image: UBUNTU_BASE_IMAGE,
    digest: metadata.value.digest,
    apt: { snapshot: UBUNTU_SNAPSHOT, packages: CURATED_BASE_PACKAGES },
  })
}

async function resolveNodeRelease(
  releaseLine: string,
  signal?: AbortSignal,
): Promise<Result<NodeRuntimeLock>> {
  const index = await fetchJson(
    NODE_RELEASE_INDEX_URL,
    signal,
    'node-resolution-failed',
    `the official Node release index for ${releaseLine}`,
  )
  if (!index.ok) {
    return index
  }

  if (!Array.isArray(index.value)) {
    return resolutionFailure(
      'node-resolution-failed',
      'The official Node release index had an invalid shape.',
    )
  }

  const revisions = index.value
    .flatMap(value => {
      if (!isRecord(value) || typeof value.version !== 'string') {
        return []
      }
      const revision = value.version.startsWith('v') ? value.version.slice(1) : value.version
      return revision.startsWith(`${releaseLine}.`) && isNodeRevision(revision) ? [revision] : []
    })
    .sort(compareNodeRevisions)
  const revision = revisions[0]
  if (revision === undefined) {
    return failure({
      kind: 'validation',
      code: 'unsupported-runtime-resolution',
      observed: `The official Node source has no release for catalog line ${releaseLine}.`,
      nextAction: 'Install a Devbox package with a currently resolvable Runtime release line.',
    })
  }

  const archiveName = `node-v${revision}-linux-x64.tar.gz`
  const signedChecksums = await fetchText(
    NODE_CHECKSUMS_URL(revision),
    signal,
    'node-resolution-failed',
    `the signed Node checksum manifest for ${revision}`,
  )
  if (!signedChecksums.ok) {
    return signedChecksums
  }

  const verifiedChecksums = await verifyNodeChecksums(signedChecksums.value, revision, signal)
  if (!verifiedChecksums.ok) {
    return verifiedChecksums
  }
  const sha256 = verifiedChecksums.value.manifest
    .split(/\r?\n/)
    .map(line => line.trim().split(/\s+/))
    .find(parts => parts[1] === archiveName)?.[0]
  if (sha256 === undefined || !/^[0-9a-f]{64}$/.test(sha256)) {
    return resolutionFailure(
      'node-resolution-failed',
      `The verified Node checksum manifest did not contain ${archiveName}.`,
    )
  }

  return success({
    revision,
    archive: { url: NODE_ARCHIVE_URL(revision), sha256 },
    signedChecksums: { url: NODE_CHECKSUMS_URL(revision), signer: verifiedChecksums.value.signer },
  })
}

async function fetchJson(
  url: string,
  signal: AbortSignal | undefined,
  code: string,
  description: string,
): Promise<Result<unknown>> {
  const response = await fetchText(url, signal, code, description)
  if (!response.ok) {
    return response
  }
  try {
    return success(JSON.parse(response.value) as unknown)
  } catch {
    return resolutionFailure(code, `${description} returned invalid JSON.`)
  }
}

async function fetchText(
  url: string,
  signal: AbortSignal | undefined,
  code: string,
  description: string,
): Promise<Result<string>> {
  try {
    const response = await fetch(url, {
      signal,
      headers: { accept: 'application/json,text/plain' },
    })
    if (!response.ok) {
      return resolutionFailure(code, `${description} returned HTTP ${response.status}.`)
    }
    return success(await response.text())
  } catch {
    if (signal?.aborted) {
      throw new PlatformLockInterruptedError()
    }
    return resolutionFailure(code, `Devbox could not read ${description} from ${url}.`)
  }
}

interface VerifiedNodeChecksums {
  readonly manifest: string
  readonly signer: string
}

async function verifyNodeChecksums(
  signedManifest: string,
  revision: string,
  signal?: AbortSignal,
): Promise<Result<VerifiedNodeChecksums>> {
  let directory: string | undefined
  try {
    directory = await mkdtemp(join(tmpdir(), 'devbox-node-checksums-'))
    const keyPath = join(directory, 'node-release-keys.asc')
    const keyringPath = join(directory, 'node-release-keyring.gpg')
    const signedPath = join(directory, `SHASUMS256-${revision}.txt.asc`)
    const verifiedPath = join(directory, `SHASUMS256-${revision}.txt`)
    await writeFile(keyPath, NODE_RELEASE_KEYS, { encoding: 'utf8', mode: 0o600 })
    await writeFile(signedPath, signedManifest, { encoding: 'utf8', mode: 0o600 })
    await execFile(
      'gpg',
      [
        '--batch',
        '--yes',
        '--no-options',
        '--homedir',
        directory,
        '--dearmor',
        '--output',
        keyringPath,
        keyPath,
      ],
      { signal },
    )
    const verification = await execFile(
      'gpgv',
      [
        '--homedir',
        directory,
        '--status-fd',
        '1',
        '--keyring',
        keyringPath,
        '--output',
        verifiedPath,
        signedPath,
      ],
      { signal },
    )
    const signer = verification.stdout.match(/^\[GNUPG:\] VALIDSIG ([0-9A-F]{40}) /m)?.[1]
    if (signer === undefined) {
      return resolutionFailure(
        'node-resolution-failed',
        `The Node checksum manifest for ${revision} did not report a trusted signer.`,
      )
    }
    return success({ manifest: await readFile(verifiedPath, 'utf8'), signer })
  } catch {
    if (signal?.aborted) {
      throw new PlatformLockInterruptedError()
    }
    return resolutionFailure(
      'node-resolution-failed',
      `Devbox could not authenticate the signed Node checksum manifest for ${revision}.`,
    )
  } finally {
    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

function resolutionFailure(code: string, observed: string): Result<never> {
  return failure({
    kind: 'operational',
    code,
    observed,
    nextAction:
      'Check network access to the official source, then run devbox update again or install a newer Devbox package.',
  })
}

function isNodeRevision(value: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+$/.test(value)
}

function compareNodeRevisions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0)
    if (difference !== 0) {
      return difference
    }
  }
  return 0
}

export async function updatePlatform(
  input: UpdatePlatformInput = {},
): Promise<Result<PlatformUpdateResult>> {
  const devboxHome = input.devboxHome ?? defaultDevboxHome()
  return withPlatformLock({ devboxHome, signal: input.signal }, () =>
    updatePlatformUnlocked({ ...input, devboxHome }),
  )
}

async function updatePlatformUnlocked(
  input: UpdatePlatformInput & { readonly devboxHome: string },
): Promise<Result<PlatformUpdateResult>> {
  if (input.signal?.aborted) {
    throw new PlatformLockInterruptedError()
  }

  const catalogCheck = normalizeCatalog(input.catalog ?? DEFAULT_RUNTIME_CATALOG)
  if (!catalogCheck.ok) {
    return failure({
      kind: 'validation',
      code: catalogCheck.error.code,
      observed: catalogCheck.error.observed,
      nextAction:
        'Install or reinstall a Devbox package with a valid packaged Runtime catalog, then run devbox update again.',
    })
  }
  const catalog = catalogCheck.value
  const paths = devboxPaths(input.devboxHome)
  const globalState = await readOptional(paths.globalConfiguration)
  if (!globalState.ok) {
    return globalState
  }
  if (!globalState.value.exists) {
    return missingConfiguration('global', paths.globalConfiguration)
  }
  const globalCheck = parseGlobalConfiguration(globalState.value.content, catalog)
  if (!globalCheck.ok) {
    return globalCheck
  }

  const registryState = await readOptional(paths.projectRegistry)
  if (!registryState.ok) {
    return registryState
  }
  const registryCheck = registryState.value.exists
    ? parseProjectRegistry(registryState.value.content)
    : success<ProjectRegistry>({ version: 1, projects: {} })
  if (!registryCheck.ok) {
    return registryCheck
  }

  const localsCheck = await readLocalConfigurations(
    input.devboxHome,
    registryCheck.value,
    globalCheck.value,
    catalog,
  )
  if (!localsCheck.ok) {
    return localsCheck
  }

  const releaseLines = configuredRuntimeSet(globalCheck.value, localsCheck.value, catalog)
  const unsupportedFamily = Object.entries(releaseLines).find(
    ([family, entries]) => family !== 'node' && entries.length > 0,
  )
  if (unsupportedFamily !== undefined) {
    return unsupportedRuntimeFamily(unsupportedFamily[0])
  }

  const resolver = input.resolver ?? DEFAULT_PLATFORM_RESOLVER
  const baseCheck = await resolver.resolveBase({
    platform: PLATFORM_TARGET,
    signal: input.signal,
  })
  if (input.signal?.aborted) {
    throw new PlatformLockInterruptedError()
  }
  if (!baseCheck.ok) {
    return baseCheck
  }

  const nodeEntries: Record<string, NodeRuntimeLock> = {}
  for (const releaseLine of releaseLines.node ?? []) {
    const nodeCheck = await resolver.resolveNode({
      releaseLine,
      platform: PLATFORM_TARGET,
      signal: input.signal,
    })
    if (input.signal?.aborted) {
      throw new PlatformLockInterruptedError()
    }
    if (!nodeCheck.ok) {
      return nodeCheck
    }
    nodeEntries[releaseLine] = nodeCheck.value
  }

  const lock: PlatformLock = {
    version: PLATFORM_VERSION,
    platform: PLATFORM_TARGET,
    base: baseCheck.value,
    runtimes: Object.keys(nodeEntries).length === 0 ? {} : { node: nodeEntries },
  }
  if (input.signal?.aborted) {
    throw new PlatformLockInterruptedError()
  }
  const serialized = serializePlatformLock(lock, releaseLines.node)
  if (input.signal?.aborted) {
    throw new PlatformLockInterruptedError()
  }
  const current = await readOptional(paths.platformLock)
  if (!current.ok) {
    return current
  }
  if (current.value.exists && current.value.content === serialized) {
    return success({
      changed: false,
      lockPath: paths.platformLock,
      runtimes: releaseLines,
    })
  }
  if (input.signal?.aborted) {
    throw new PlatformLockInterruptedError()
  }

  const written = await writeAtomically(paths.platformLock, serialized)
  if (!written.ok) {
    return written
  }
  return success({ changed: true, lockPath: paths.platformLock, runtimes: releaseLines })
}

export function serializePlatformLock(
  lock: PlatformLock,
  nodeOrder: readonly string[] = [],
): string {
  const nodeEntries = new Map<string, Record<string, unknown>>()
  const nodeLock = lock.runtimes.node
  if (nodeLock !== undefined) {
    const orderedReleaseLines =
      nodeOrder.length > 0
        ? nodeOrder
        : [...(DEFAULT_RUNTIME_CATALOG.runtimes.node ?? []), ...Object.keys(nodeLock)]
    for (const releaseLine of orderedReleaseLines) {
      const entry = nodeLock[releaseLine]
      if (entry !== undefined) {
        nodeEntries.set(releaseLine, serializeNodeLock(entry))
      }
    }
    for (const [releaseLine, entry] of Object.entries(nodeLock)) {
      if (!nodeEntries.has(releaseLine)) {
        nodeEntries.set(releaseLine, serializeNodeLock(entry))
      }
    }
  }
  const runtimes = nodeEntries.size === 0 ? {} : { node: nodeEntries }
  return stringify({
    version: lock.version,
    platform: lock.platform,
    base: {
      image: lock.base.image,
      digest: lock.base.digest,
      apt: {
        snapshot: lock.base.apt.snapshot,
        packages: [...lock.base.apt.packages],
      },
    },
    runtimes,
  })
}

function serializeNodeLock(entry: NodeRuntimeLock): Record<string, unknown> {
  return {
    revision: entry.revision,
    archive: { url: entry.archive.url, sha256: entry.archive.sha256 },
    signedChecksums: { url: entry.signedChecksums.url, signer: entry.signedChecksums.signer },
  }
}

function configuredRuntimeSet(
  globalConfiguration: GlobalConfiguration,
  locals: ReadonlyMap<string, LocalConfiguration>,
  catalog: RuntimeCatalog,
): Record<string, readonly string[]> {
  const configured: Record<string, readonly string[]> = {}
  for (const family of Object.keys(catalog.runtimes)) {
    const entries = new Set(globalConfiguration.runtimes[family] ?? [])
    for (const local of locals.values()) {
      const selected = local.toolchain[family]
      if (selected !== null && selected !== undefined) {
        entries.add(selected)
      }
    }
    const catalogOrder = catalog.runtimes[family] ?? []
    configured[family] = catalogOrder.filter(entry => entries.has(entry))
  }
  return configured
}

async function readLocalConfigurations(
  devboxHome: string,
  registry: ProjectRegistry,
  globalConfiguration: GlobalConfiguration,
  catalog: RuntimeCatalog,
): Promise<Result<ReadonlyMap<string, LocalConfiguration>>> {
  const paths = devboxPaths(devboxHome)
  const locals = new Map<string, LocalConfiguration>()
  for (const [root, stateDirectory] of Object.entries(registry.projects)) {
    const localPath = join(paths.projects, stateDirectory, 'config.yaml')
    const state = await readOptional(localPath)
    if (!state.ok) {
      return state
    }
    if (!state.value.exists) {
      return missingConfiguration('local', localPath)
    }
    const localCheck = parseLocalConfiguration(state.value.content, globalConfiguration, catalog)
    if (!localCheck.ok) {
      return localCheck
    }
    locals.set(root, localCheck.value)
  }
  return success(locals)
}

function defaultDevboxHome(): string {
  return join(homedir(), '.devbox')
}

async function readOptional(
  path: string,
): Promise<Result<{ readonly exists: boolean; readonly content: string }>> {
  try {
    return success({ exists: true, content: await readFile(path, 'utf8') })
  } catch (error) {
    if (isMissingFileError(error)) {
      return success({ exists: false, content: '' })
    }
    return failure({
      kind: 'operational',
      code: 'state-read-failed',
      observed: `Devbox could not read state file: ${path}.`,
      nextAction: 'Check write access to ~/.devbox and run devbox update again.',
    })
  }
}

async function writeAtomically(path: string, content: string): Promise<Result<void>> {
  const directory = dirname(path)
  const temporaryPath = join(directory, `.${basename(path)}-${process.pid}-${randomUUID()}.tmp`)
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporaryPath, path)
    return success(undefined)
  } catch {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    return failure({
      kind: 'operational',
      code: 'state-write-failed',
      observed: `Devbox could not atomically write state file: ${path}.`,
      nextAction: 'Check write access to ~/.devbox and run devbox update again.',
    })
  }
}

function unsupportedRuntimeFamily(family: string): Result<never> {
  return failure({
    kind: 'validation',
    code: 'unsupported-runtime-family',
    observed: `The packaged Runtime family is not supported by this Platform resolver: ${family}.`,
    nextAction:
      'Install a Devbox package with a supported Runtime recipe or remove the unsupported Runtime from Global and Local configuration.',
  })
}
function missingConfiguration(scope: 'global' | 'local', path: string): Result<never> {
  return failure({
    kind: 'validation',
    code: `missing-${scope}-configuration`,
    observed: `Devbox could not find the ${scope} configuration: ${path}.`,
    nextAction: `Restore the supported version-1 ${scope} YAML configuration and run devbox update again.`,
  })
}
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
