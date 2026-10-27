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

/** Separate, real-source topologies exercise different dependencies instead
 * of optimizing solely for the dense Composer import graph. These lists select
 * modules, never author or infer any relationship between them. */
export const qualityPipelineModules = [
  'diagramQuality', 'diagramGeometry', 'diagramBrowserGeometry',
  'diagramPresentationAB', 'mermaidQuality', 'mermaidVisualGrammar',
  'diagramVisualStyles', 'canvasQuality', 'canvas',
  'colors', 'types', 'canvasLabelText',
] as const

export const canvasEditingModules = [
  'canvasPatch', 'canvasOperations', 'canvas', 'canvasQuality',
  'canvasDependencyLens', 'canvasNodeTitleLayout', 'canvasLabelText',
  'canvasViewport', 'canvasRectIndex', 'canvasHistory', 'canvasPlayback',
  'architectureNodeTemplates', 'architectureRouting',
  'architecturePortPlanning', 'architectureOrthogonalSolver',
] as const

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))

export type SourceArchitectureCase = {
  id: string
  description: string
  source: 'project'
  intent: ArchitectureIntentGraph
}

async function sourceImportCase(
  id: string, title: string, modules: readonly string[], description: string,
): Promise<SourceArchitectureCase> {
  const selected = new Set(modules)
  if (selected.size !== modules.length) throw new Error(`Duplicate source modules in ${id}`)
  const imports: Array<{ from: string; to: string }> = []
  for (const module of modules) {
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
    id, description,
    source: 'project',
    intent: {
      title,
      theme: 'technical',
      nodes: modules.map((module) => ({
        id: module,
        text: module,
        sourcePaths: [`src/${module}.ts`],
      })),
      relations,
    },
  }
}

/** The original real-source acceptance case retains its exact input contract. */
export function projectArchitectureCase(): Promise<SourceArchitectureCase> {
  return sourceImportCase('diagram-plugin-source-imports', 'Diagram Plugin 核心模块真实导入关系',
    coreArchitectureModules, '真实源码静态 import 子图：仅所列 12 个架构模块，包含类型导入，不代表运行时调用')
}

/** Additional bounded, evidence-backed sources for multi-topology A/B.
 * They are not used to weaken or replace the strict original acceptance gate. */
export async function projectArchitectureCases(): Promise<SourceArchitectureCase[]> {
  return Promise.all([
    projectArchitectureCase(),
    sourceImportCase('diagram-plugin-quality-imports', 'Diagram Plugin 图表质量流水线真实导入',
      qualityPipelineModules, '真实源码：质量测量、Mermaid 及 Canvas 公共依赖子图'),
    sourceImportCase('diagram-plugin-canvas-imports', 'Diagram Plugin Canvas 编辑流水线真实导入',
      canvasEditingModules, '真实源码：Canvas 编辑操作、资源和路由依赖子图'),
  ])
}
