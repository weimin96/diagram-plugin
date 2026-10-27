import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import type { ArchitectureIntentGraph } from '../src/architectureComposer.js'

export interface ExternalSourceCase {
  id: string
  source: 'project'
  description: string
  intent: ArchitectureIntentGraph
  provenance: {
    repository: string
    revision: string
    trackedSourceFiles: number
    uncommitted: boolean
    /** A source file + line is direct evidence; never inferred from a name. */
    imports: Array<{ from: string; to: string; line: number; sourceSha256: string }>
  }
}

type TrackedSource = { relative: string; sha256: string; imports: Array<{ target: string; line: number }> }
const sourceExtension = /\.(?:ts|tsx|mts|cts)$/
const ignored = /(?:^|\/)(?:tests?|__tests__|fixtures?|examples?|node_modules|dist|build|\.next)(?:\/|$)/

/** Explicit, read-only corpus roots. A local path is never embedded in the
 * report and no source text is copied into tracked files or benchmark output.
 * Imports are literal relative TypeScript module imports only. */
export async function externalArchitectureSourceCases(label: string, rootPath: string, maxCases = 2): Promise<ExternalSourceCase[]> {
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(label)) throw new Error('Repository label must be a safe, explicit slug')
  if (!path.isAbsolute(rootPath)) throw new Error('An external source repository requires an absolute path')
  if (!Number.isInteger(maxCases) || maxCases < 1 || maxCases > 4) throw new Error('maxCases must be 1..4')
  const root = await realpath(rootPath)
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  }).trim()
  if (git('rev-parse', '--show-toplevel') !== root) throw new Error('Explicit source path must be a Git repository root')
  const revision = git('rev-parse', 'HEAD')
  const filenames = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  }).split('\0').filter((file) => sourceExtension.test(file) && !ignored.test(file)
    && !file.endsWith('.d.ts'))
  if (filenames.length > 2500) throw new Error('Too many tracked source files: pass a narrower repository')
  const sourceFiles = filenames.map((file) => path.posix.normalize(file.replaceAll('\\', '/')))
  const known = new Set(sourceFiles)
  const files: TrackedSource[] = []
  for (const relative of sourceFiles) {
    const absolute = path.resolve(root, relative)
    if (!absolute.startsWith(root + path.sep)) throw new Error('Unsafe tracked source path')
    const actual = await realpath(absolute)
    if (!actual.startsWith(root + path.sep)) throw new Error('Tracked source symlink escapes repository')
    const contents = await readFile(actual, 'utf8')
    const tree = ts.createSourceFile(relative, contents, ts.ScriptTarget.Latest, true,
      /\.(tsx)$/.test(relative) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const imports: TrackedSource['imports'] = []
    for (const statement of tree.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const specifier = statement.moduleSpecifier.text
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier))
        .replace(/\.(?:jsx?|mjs|cjs|ts|tsx|mts|cts)$/, '')
      const target = [`${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`,
        `${base}/index.ts`, `${base}/index.tsx`].find((file) => known.has(file))
      if (target && target !== relative) imports.push({ target,
        line: tree.getLineAndCharacterOfPosition(statement.getStart(tree)).line + 1 })
    }
    files.push({ relative, sha256: createHash('sha256').update(contents).digest('hex'), imports })
  }
  const byFile = new Map(files.map((file) => [file.relative, file]))
  const neighbor = new Map(files.map((file) => [file.relative, new Set<string>()]))
  for (const file of files) for (const edge of file.imports) {
    neighbor.get(file.relative)!.add(edge.target)
    neighbor.get(edge.target)!.add(file.relative)
  }
  const ranked = files.filter((file) => neighbor.get(file.relative)!.size >= 2)
    .sort((a, b) => neighbor.get(b.relative)!.size - neighbor.get(a.relative)!.size
      || a.relative.localeCompare(b.relative, 'en'))
  const cases: ExternalSourceCase[] = []
  const used = new Set<string>()
  for (const seed of ranked) {
    if (cases.length >= maxCases) break
    const chosen = new Set<string>([seed.relative])
    while (chosen.size < 16) {
      const options = [...new Set([...chosen].flatMap((id) => [...neighbor.get(id)!]))]
        .filter((id) => !chosen.has(id) && byFile.has(id))
        .sort((a, b) => {
          const shared = (id: string) => [...neighbor.get(id)!].filter((other) => chosen.has(other)).length
          return shared(b) - shared(a) || neighbor.get(b)!.size - neighbor.get(a)!.size || a.localeCompare(b, 'en')
        })
      if (!options.length) break
      chosen.add(options[0])
    }
    if (chosen.size < 8 || [...chosen].filter((id) => used.has(id)).length > 5) continue
    const ids = [...chosen].sort((a, b) => a.localeCompare(b, 'en'))
    const edges = ids.flatMap((id) => byFile.get(id)!.imports.filter((edge) => chosen.has(edge.target))
      .map((edge) => ({ from: id, to: edge.target, line: edge.line, sourceSha256: byFile.get(id)!.sha256 })))
    const distinctEdges = [...new Map(edges.map((edge) => [`${edge.from}\0${edge.to}`, edge])).values()]
    if (distinctEdges.length < 7 || distinctEdges.length > 90) continue
    const nodeIds = new Map(ids.map((id) => [id,
      `m_${createHash('sha256').update(`${label}:${id}`).digest('hex').slice(0, 16)}`]))
    const reference = `${label}-${cases.length + 1}`
    const imports = distinctEdges.map((edge) => ({ from: edge.from, to: edge.to, line: edge.line,
      sourceSha256: edge.sourceSha256 }))
    cases.push({ id: reference, source: 'project',
      description: `Verified static TypeScript imports in ${label}; sampled module subgraph, not service calls or user-approved system topology`,
      intent: { title: `${label} · verified module dependencies`, theme: 'technical',
        nodes: ids.map((id) => ({ id: nodeIds.get(id)!, text: path.posix.basename(id).replace(sourceExtension, ''),
          sourcePaths: [id] })),
        relations: distinctEdges.map((edge) => ({ from: nodeIds.get(edge.from)!, to: nodeIds.get(edge.to)! })),
      },
      provenance: { repository: label, revision, trackedSourceFiles: files.length,
        uncommitted: git('status', '--porcelain', '--untracked-files=no').length > 0, imports },
    })
    ids.forEach((id) => used.add(id))
  }
  return cases
}

/** Repeatable CLI opt-in, never infer or traverse sibling repositories. */
export function parseExternalRepoArgs(args: string[]): Array<{ label: string; root: string }> {
  const seen = new Set<string>()
  return args.filter((arg) => arg.startsWith('--repo=')).map((arg) => {
    const raw = arg.slice('--repo='.length)
    const separator = raw.indexOf(':')
    if (separator < 1) throw new Error('Expected --repo=label:/absolute/path')
    const label = raw.slice(0, separator), root = raw.slice(separator + 1)
    if (seen.has(label)) throw new Error(`Duplicate source repository label ${label}`)
    seen.add(label)
    return { label, root }
  })
}
