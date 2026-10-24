import { lstat, mkdir, open, readFile, readdir, realpath, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import lockfile from 'proper-lockfile'
import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { createCanvasSource, type CanvasWorkbenchMode } from './canvas.js'
import { createTemplate, detectDiagramType } from './templates.js'
import type { DiagramCanvasWorkbench, DiagramDocument, DiagramRevision, DiagramSummary, DiagramType, MermaidDiagramType } from './types.js'

const allowedExtensions = new Set(['.mmd', '.mermaid'])
const allowedExportExtensions = new Set(['.svg', '.png'])
const canvasImageMimeExtensions = new Map<string, string>([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
] as const)
const canvasImageExtensionMimes = new Map<string, string>([...canvasImageMimeExtensions].map(([mime, extension]) => [extension, mime]))
const maxCanvasImageBytes = 12 * 1024 * 1024
const sourceExtensions = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.gradle', '.graphql', '.gql', '.h', '.hpp', '.html', '.java',
  '.js', '.jsx', '.json', '.kt', '.kts', '.less', '.mjs', '.cjs', '.php', '.properties', '.proto', '.py', '.rb',
  '.rs', '.scala', '.scss', '.sql', '.svelte', '.swift', '.toml', '.ts', '.tsx', '.vue', '.xml', '.yaml', '.yml',
])
const sourceNames = new Set(['Dockerfile', 'Makefile', 'CMakeLists.txt', 'pom.xml', 'build.gradle', 'settings.gradle'])
const ignoredDirectories = new Set([
  '.git', '.idea', '.gradle', '.mvn', '.venv', '.dart_tool', '__pycache__',
  'node_modules', 'vendor', 'venv', 'Pods', 'dist', 'build', 'out', 'coverage', '.next', '.turbo', '.cache', 'target',
])
const maxDepth = 7
const maxDiagrams = 500
const workspaceMutations = new Map<string, Promise<void>>()

export class DiagramStore {
  constructor(readonly workspacePath: string) {}

  static async open(input: string): Promise<DiagramStore> {
    const expanded = expandHome(input.trim())
    if (!expanded) throw new Error('请输入工作空间路径。')
    const resolved = await realpath(path.resolve(expanded)).catch(() => null)
    if (!resolved) throw new Error('工作空间不存在。')
    const info = await stat(resolved)
    if (!info.isDirectory()) throw new Error('工作空间路径不是目录。')
    return new DiagramStore(resolved)
  }

  async list(): Promise<DiagramSummary[]> {
    const results: DiagramSummary[] = []
    await this.scan(this.workspacePath, 0, results)
    return results.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
  }

  async get(relativePath: string): Promise<DiagramDocument> {
    const target = await this.resolveExistingDiagram(relativePath)
    const file = await open(target, 'r')
    try {
      const [source, info] = await Promise.all([file.readFile('utf8'), file.stat()])
      return this.document(relativePathFromRoot(this.workspacePath, target), source, info.mtime)
    } finally {
      await file.close()
    }
  }

  async revision(relativePath: string): Promise<DiagramRevision> {
    const target = await this.resolveExistingDiagram(relativePath)
    const info = await stat(target)
    return {
      path: relativePathFromRoot(this.workspacePath, target),
      modifiedAt: info.mtime.toISOString(),
    }
  }

  async create(type: DiagramType, title: string, canvasWorkbench?: CanvasWorkbenchMode): Promise<DiagramDocument> {
    return withWorkspaceMutation(this.workspacePath, async () => {
      const directory = await this.prepareDirectory(['docs', 'diagrams'])
      const base = slugify(title) || type
      const target = await nextAvailablePath(directory, base, type === 'canvas' ? '.diagram.json' : '.mmd')
      const source = type === 'canvas' ? createCanvasSource(title, canvasWorkbench) : createTemplate(type as MermaidDiagramType, title)
      await writeFile(target, source, { encoding: 'utf8', flag: 'wx' })
      const info = await stat(target)
      return this.document(relativePathFromRoot(this.workspacePath, target), source, info.mtime)
    })
  }

  async listSourceFiles(limit = 5_000): Promise<string[]> {
    const results: string[] = []
    await this.scanSources(this.workspacePath, 0, results, Math.max(1, Math.min(limit, 10_000)))
    return results.sort((left, right) => left.localeCompare(right))
  }

  async update(relativePath: string, source: string, expectedModifiedAt?: string): Promise<DiagramDocument> {
    return withWorkspaceMutation(this.workspacePath, async () => {
      const target = await this.resolveExistingDiagram(relativePath)
      await assertExpectedRevision(target, expectedModifiedAt)
      const before = await stat(target)
      const staging = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.pending`)
      try {
        await writeFile(staging, normalizeSource(source), { encoding: 'utf8', flag: 'wx', mode: before.mode & 0o777 })
        // Revisions are exposed at millisecond precision; even a fast save must
        // invalidate the revision that was used to submit it.
        const modifiedAt = new Date(Math.max(Date.now(), before.mtime.getTime() + 1))
        await utimes(staging, before.atime, modifiedAt)
        await assertExpectedRevision(target, expectedModifiedAt)
        await rename(staging, target)
      } finally {
        await unlink(staging).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        })
      }
      const info = await stat(target)
      return this.document(relativePathFromRoot(this.workspacePath, target), normalizeSource(source), info.mtime)
    })
  }

  async restore(relativePath: string, source: string): Promise<DiagramDocument> {
    return withWorkspaceMutation(this.workspacePath, async () => {
      const lexical = path.resolve(this.workspacePath, relativePath)
      assertInside(this.workspacePath, lexical)
      if (!isDiagramFile(lexical)) throw new Error('只支持 .mmd、.mermaid 和 .diagram.json 图表文件。')
      const directory = await realpath(path.dirname(lexical))
      assertInside(this.workspacePath, directory)
      const target = path.join(directory, path.basename(lexical))
      await writeFile(target, normalizeSource(source), { encoding: 'utf8', flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST') throw new Error('原路径已存在文件，请先处理外部修改再恢复草稿。')
        throw error
      })
      const info = await stat(target)
      return this.document(relativePathFromRoot(this.workspacePath, target), normalizeSource(source), info.mtime)
    })
  }

  async rename(relativePath: string, title: string, expectedModifiedAt?: string): Promise<DiagramDocument> {
    return withWorkspaceMutation(this.workspacePath, async () => {
      const target = await this.resolveExistingDiagram(relativePath)
      await assertExpectedRevision(target, expectedModifiedAt)
      const source = await readFile(target, 'utf8')
      const base = slugify(title)
      if (!base) throw new Error('请输入有效的图表名称。')
      const destination = path.join(path.dirname(target), `${base}${diagramExtension(target)}`)
      assertInside(this.workspacePath, destination)
      if (destination !== target) {
        const existing = await lstat(destination).catch((error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        })
        if (existing) throw new Error(`同目录下已存在图表：${path.basename(destination)}`)
        await rename(target, destination)
      }
      const info = await stat(destination)
      return this.document(relativePathFromRoot(this.workspacePath, destination), source, info.mtime)
    })
  }

  async duplicate(relativePath: string, title?: string): Promise<DiagramDocument> {
    return withWorkspaceMutation(this.workspacePath, async () => {
      const target = await this.resolveExistingDiagram(relativePath)
      const source = await readFile(target, 'utf8')
      const extension = diagramExtension(target)
      const originalName = path.basename(target).slice(0, -extension.length)
      const base = slugify(title?.trim() || `${originalName}-copy`) || `${originalName}-copy`
      const destination = await nextAvailablePath(path.dirname(target), base, extension)
      await writeFile(destination, normalizeSource(source), { encoding: 'utf8', flag: 'wx' })
      const info = await stat(destination)
      return this.document(relativePathFromRoot(this.workspacePath, destination), normalizeSource(source), info.mtime)
    })
  }

  async delete(relativePath: string, expectedModifiedAt?: string): Promise<string> {
    return withWorkspaceMutation(this.workspacePath, async () => {
      const target = await this.resolveExistingDiagram(relativePath)
      await assertExpectedRevision(target, expectedModifiedAt)
      const deletedPath = relativePathFromRoot(this.workspacePath, target)
      await unlink(target)
      return deletedPath
    })
  }

  async exportAsset(filename: string, content: string | Uint8Array): Promise<string> {
    return withWorkspaceMutation(this.workspacePath, async () => {
      const requested = filename.trim()
      if (!requested || path.basename(requested) !== requested) throw new Error('导出文件名无效。')
      const extension = path.extname(requested).toLowerCase()
      if (!allowedExportExtensions.has(extension)) throw new Error('只支持导出 SVG 和 PNG。')
      const base = slugify(path.basename(requested, extension)) || 'diagram'
      const directory = await this.prepareDirectory(['docs', 'diagrams', 'exports'])
      const target = await nextAvailablePath(directory, base, extension)
      await writeFile(target, content, { flag: 'wx' })
      return relativePathFromRoot(this.workspacePath, target)
    })
  }

  async importCanvasImage(diagramPath: string, filename: string, mimeType: string, content: Uint8Array): Promise<{ path: string; mimeType: string }> {
    return withWorkspaceMutation(this.workspacePath, async () => {
      await this.resolveExistingDiagram(diagramPath)
      const extension = canvasImageMimeExtensions.get(mimeType)
      if (!extension) throw new Error('只支持 PNG、JPEG 和 WebP 图片。')
      if (!content.byteLength || content.byteLength > maxCanvasImageBytes) throw new Error('图片大小必须在 12MB 以内。')
      const rawBase = path.basename(filename, path.extname(filename))
      const base = slugify(rawBase) || 'image'
      const directory = await this.prepareDirectory(['docs', 'diagrams', 'assets'])
      const target = path.join(directory, `${base}-${randomUUID().slice(0, 8)}${extension}`)
      assertInside(this.workspacePath, target)
      await writeFile(target, content, { flag: 'wx' })
      return { path: relativePathFromRoot(this.workspacePath, target), mimeType }
    })
  }

  async readCanvasImage(relativePath: string): Promise<{ path: string; mimeType: string; content: Uint8Array }> {
    if (!relativePath.trim()) throw new Error('图片资源路径不能为空。')
    const lexical = path.resolve(this.workspacePath, relativePath)
    const assetRoot = path.join(this.workspacePath, 'docs', 'diagrams', 'assets')
    assertInside(assetRoot, lexical)
    const extension = path.extname(lexical).toLowerCase()
    const mimeType = canvasImageExtensionMimes.get(extension)
    if (!mimeType) throw new Error('只支持 PNG、JPEG 和 WebP 图片。')
    const target = await realpath(lexical).catch(() => null)
    if (!target) throw new Error(`图片资源不存在：${relativePath}`)
    assertInside(assetRoot, target)
    const info = await lstat(target)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('图片资源路径必须指向普通文件。')
    if (info.size > maxCanvasImageBytes) throw new Error('图片大小超过 12MB。')
    return { path: relativePathFromRoot(this.workspacePath, target), mimeType, content: await readFile(target) }
  }

  private async prepareDirectory(segments: string[]): Promise<string> {
    let directory = this.workspacePath
    for (const segment of segments) {
      const candidate = path.join(directory, segment)
      await mkdir(candidate).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
      directory = await realpath(candidate)
      assertInside(this.workspacePath, directory)
      if (!(await stat(directory)).isDirectory()) throw new Error('图表目录必须指向目录。')
    }
    return directory
  }

  private async scan(directory: string, depth: number, results: DiagramSummary[]): Promise<void> {
    if (depth > maxDepth || results.length >= maxDiagrams) return
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (results.length >= maxDiagrams) return
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await this.scan(target, depth + 1, results)
        continue
      }
      if (!entry.isFile() || !isDiagramFile(entry.name)) continue
      // 扫描期间被删除、无读权限或断链的文件只跳过，不能让整次 list 失败。
      try {
        const info = await lstat(target)
        if (info.isSymbolicLink()) continue
        const source = await readFile(target, 'utf8')
        results.push(this.summary(relativePathFromRoot(this.workspacePath, target), source, info.mtime))
      } catch {
        continue
      }
    }
  }

  private async scanSources(directory: string, depth: number, results: string[], limit: number): Promise<void> {
    if (depth > maxDepth || results.length >= limit) return
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (results.length >= limit) return
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await this.scanSources(target, depth + 1, results, limit)
        continue
      }
      if (!entry.isFile()) continue
      if (isDiagramFile(entry.name)) continue
      const extension = path.extname(entry.name).toLowerCase()
      if (!sourceExtensions.has(extension) && !sourceNames.has(entry.name)) continue
      const info = await lstat(target).catch(() => null)
      if (!info || info.isSymbolicLink()) continue
      results.push(relativePathFromRoot(this.workspacePath, target))
    }
  }

  private async resolveExistingDiagram(relativePath: string): Promise<string> {
    if (!relativePath.trim()) throw new Error('图表路径不能为空。')
    const lexical = path.resolve(this.workspacePath, relativePath)
    assertInside(this.workspacePath, lexical)
    if (!isDiagramFile(lexical)) throw new Error('只支持 .mmd、.mermaid 和 .diagram.json 图表文件。')
    const target = await realpath(lexical).catch(() => null)
    if (!target) throw new Error(`图表不存在：${relativePath}`)
    assertInside(this.workspacePath, target)
    const info = await lstat(target)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('图表路径必须指向普通文件。')
    return target
  }

  private summary(relativePath: string, source: string, modifiedAt: Date): DiagramSummary {
    const extension = diagramExtension(relativePath)
    return {
      path: relativePath,
      name: path.basename(relativePath).slice(0, -extension.length),
      type: extension === '.diagram.json' ? 'canvas' : detectDiagramType(source),
      modifiedAt: modifiedAt.toISOString(),
      ...(extension === '.diagram.json' ? { canvasWorkbench: readCanvasWorkbench(source) } : {}),
    }
  }

  private document(relativePath: string, source: string, modifiedAt: Date): DiagramDocument {
    return { ...this.summary(relativePath, source, modifiedAt), source }
  }
}

function readCanvasWorkbench(source: string): DiagramCanvasWorkbench | undefined {
  try {
    const scene = JSON.parse(source) as { workbench?: unknown; architecture?: unknown }
    if (!scene || typeof scene !== 'object') return undefined
    if (scene.architecture && typeof scene.architecture === 'object') return 'architecture'
    if (scene.workbench === 'architecture' || scene.workbench === 'flowchart') return scene.workbench
    return 'freeform'
  } catch {
    return undefined
  }
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('图表路径必须位于当前工作空间内。')
}

function relativePathFromRoot(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/')
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return value
}

function normalizeSource(source: string): string {
  return source.endsWith('\n') ? source : `${source}\n`
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

async function nextAvailablePath(directory: string, base: string, extension = '.mmd'): Promise<string> {
  for (let index = 0; index < 10_000; index += 1) {
    const suffix = index === 0 ? '' : `-${index + 1}`
    const candidate = path.join(directory, `${base}${suffix}${extension}`)
    try {
      await lstat(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate
      throw error
    }
  }
  throw new Error('无法为新图表生成可用文件名。')
}

function isDiagramFile(value: string): boolean {
  const lower = value.toLowerCase()
  return lower.endsWith('.diagram.json') || allowedExtensions.has(path.extname(lower))
}

function diagramExtension(value: string): string {
  return value.toLowerCase().endsWith('.diagram.json') ? '.diagram.json' : path.extname(value).toLowerCase()
}

async function assertExpectedRevision(target: string, expectedModifiedAt?: string): Promise<void> {
  if (!expectedModifiedAt) return
  const current = await stat(target)
  if (current.mtime.toISOString() !== expectedModifiedAt) {
    throw new Error('图表已被其他编辑器修改，请重新载入最新版本后再继续。')
  }
}

async function withWorkspaceMutation<T>(workspace: string, operation: () => Promise<T>): Promise<T> {
  const previous = workspaceMutations.get(workspace)
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  workspaceMutations.set(workspace, pending)
  await previous
  let unlock: (() => Promise<void>) | undefined
  try {
    unlock = await lockfile.lock(workspace, {
      lockfilePath: path.join(os.tmpdir(), `diagram-plugin-${createHash('sha256').update(workspace).digest('hex')}.lock`),
      retries: { retries: 12, minTimeout: 25, maxTimeout: 200, randomize: true },
    }).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === 'ELOCKED') throw new Error('工作区正在由其他 Diagram 实例写入，请稍后重试。', { cause })
      throw cause
    })
    return await operation()
  } finally {
    try { await unlock?.() } finally {
      release()
      if (workspaceMutations.get(workspace) === pending) workspaceMutations.delete(workspace)
    }
  }
}
