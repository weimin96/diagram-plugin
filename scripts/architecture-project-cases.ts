import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import type { ArchitectureIntentGraph } from '../src/architectureComposer.js'

/** A bounded, reproducible real-source topology. This is intentionally a
 * SUBGRAPH of the plugin's core architecture modules, not a complete package
 * dependency graph or a claim about runtime calls. Relationships are actual
 * static TS imports (including type-only imports), never inferred from names.
 */
export const coreArchitectureModules = [
  'architectureComposer',
  'architectureDesign',
  'architectureRouting',
  'architectureOrthogonalSolver',
  'architectureRouteRepair',
  'architecturePortPlanning',
  'architectureRouteDiagnostics',
  'architectureVisualPlan',
  'architecturePresentationQuality',
  'architecturePartitionFlow',
  'canvasQuality',
  'canvas',
] as const

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))

export async function projectArchitectureCase(): Promise<{
  id: string
  description: string
  source: 'project'
  intent: ArchitectureIntentGraph
}> {
  const selected = new Set<string>(coreArchitectureModules)
  const imports: Array<{ from: string; to: string }> = []
  for (const module of coreArchitectureModules) {
    const filename = path.join(sourceRoot, `${module}.ts`)
    const content = await readFile(filename, 'utf8')
    const ast = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true)
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const specifier = statement.moduleSpecifier.text
      if (!specifier.startsWith('./')) continue
      const target = path.posix.basename(specifier).replace(/\.(?:js|ts|tsx)$/, '')
      if (target !== module && selected.has(target)) imports.push({ from: module, to: target })
    }
  }
  const relations = [...new Map(imports.map((relation) =>
    [`${relation.from}\u0000${relation.to}`, relation] as const)).values()]
    .sort((a, b) => a.from.localeCompare(b.from, 'en') || a.to.localeCompare(b.to, 'en'))
  return {
    id: 'diagram-plugin-source-imports',
    description: '真实源码静态 import 子图：仅所列 12 个架构模块，包含类型导入，不代表运行时调用',
    source: 'project',
    intent: {
      title: 'Diagram Plugin 核心模块真实导入关系',
      theme: 'technical',
      nodes: coreArchitectureModules.map((module) => ({
        id: module,
        text: module,
        sourcePaths: [`src/${module}.ts`],
      })),
      relations,
    },
  }
}
