import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod/v4'
import type { ArchitectureIntentGraph } from '../src/architectureComposer.js'

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
const evidenceId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const evidenceRefs = z.array(evidenceId).min(1)

const taskSchema = z.object({
  id, repository: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
  purpose: z.string().trim().min(12).max(400),
  readingGoal: z.string().trim().min(12).max(400),
  intent: z.object({
    title: z.string().trim().min(2).max(120),
    nodes: z.array(z.object({
      id, text: z.string().trim().min(1).max(100),
      partition: z.enum(['external', 'experience', 'application', 'processing', 'data']),
      evidenceIds: evidenceRefs,
    })).min(3).max(80),
    relations: z.array(z.object({
      from: id, to: id, label: z.string().max(64).optional(),
      evidenceIds: evidenceRefs,
    })).min(2).max(160),
    primaryPath: z.array(id).min(2).max(30),
  }),
  evidence: z.array(z.object({
    id: evidenceId,
    relativePath: z.string().min(1).max(400),
    fileSha256: digest,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })).min(1).max(200),
})
const manifestSchema = z.object({ version: z.literal(1), tasks: z.array(taskSchema).max(100) })
const ledgerSchema = z.object({
  version: z.literal(1),
  /** A separate, manually provided record; NEVER written by the generator. */
  manifestSha256: digest,
  reviews: z.array(z.object({
    taskId: id,
    reviewer: z.string().trim().min(3).max(120),
    reviewedAt: z.string().datetime({ offset: true }),
    decision: z.enum(['approved', 'rejected']),
  })),
})

export interface ReviewedArchitectureTask {
  id: string
  repository: string
  purpose: string
  readingGoal: string
  intent: ArchitectureIntentGraph
  evidenceDigest: string
  /** An explicit independent ledger attestation, NOT identity verification. */
  reviewAttested: boolean
  reviewer?: string
}

export interface ArchitectureTaskLoadResult {
  manifestSha256: string
  cases: ReviewedArchitectureTask[]
  pendingReview: number
}

/** A fixed scope local evidence validator; code cannot approve its own output.
 * File hashes prove exact bytes only. The reviewer is responsible for checking
 * whether the cited lines actually support each architectural claim.
 */
export async function loadArchitectureReviewedTasks(
  manifestFile: string,
  repositories: ReadonlyMap<string, string>,
  reviewLedgerFile?: string,
): Promise<ArchitectureTaskLoadResult> {
  if (!path.isAbsolute(manifestFile)) throw new Error('Task manifest requires an absolute path')
  const rawManifest = await readFile(manifestFile)
  if (rawManifest.byteLength > 1024 * 1024) throw new Error('Task manifest exceeds 1 MiB')
  const manifestSha256 = createHash('sha256').update(rawManifest).digest('hex')
  const manifest = manifestSchema.parse(JSON.parse(rawManifest.toString('utf8')))
  if (new Set(manifest.tasks.map((task) => task.id)).size !== manifest.tasks.length) {
    throw new Error('Duplicate architecture task ID')
  }
  const roots = new Map<string, string>()
  for (const [label, root] of repositories) {
    if (!path.isAbsolute(root)) throw new Error('Repository path must be absolute')
    roots.set(label, await realpath(root))
  }
  let approved = new Map<string, { reviewer: string; decision: 'approved' | 'rejected' }>()
  if (reviewLedgerFile) {
    if (!path.isAbsolute(reviewLedgerFile)) throw new Error('Review ledger requires an absolute path')
    const data = await readFile(reviewLedgerFile)
    if (data.byteLength > 128 * 1024) throw new Error('Review ledger exceeds 128 KiB')
    const ledger = ledgerSchema.parse(JSON.parse(data.toString('utf8')))
    if (ledger.manifestSha256 !== manifestSha256) throw new Error('Review ledger refers to a stale task manifest')
    if (new Set(ledger.reviews.map((review) => review.taskId)).size !== ledger.reviews.length) {
      throw new Error('Duplicate task review')
    }
    approved = new Map(ledger.reviews.map((review) => [review.taskId, review]))
    if ([...approved.keys()].some((taskId) => !manifest.tasks.some((task) => task.id === taskId))) {
      throw new Error('Review ledger references an unknown task')
    }
  }

  const cases: ReviewedArchitectureTask[] = []
  const shaFile = new Map<string, { sha256: string; lineCount: number }>()
  for (const task of manifest.tasks) {
    const root = roots.get(task.repository)
    if (!root) throw new Error(`Unmapped evidence repository: ${task.repository}`)
    const evidenceIds = new Set(task.evidence.map((item) => item.id))
    if (evidenceIds.size !== task.evidence.length) throw new Error(`Duplicate evidence ID in ${task.id}`)
    const nodeIds = new Set(task.intent.nodes.map((node) => node.id))
    if (nodeIds.size !== task.intent.nodes.length) throw new Error(`Duplicate node ID in ${task.id}`)
    const relations = new Set<string>()
    for (const edge of task.intent.relations) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error(`Unknown relation endpoint in ${task.id}`)
      const key = `${edge.from}\0${edge.to}`
      if (relations.has(key)) throw new Error(`Duplicate directed relation in ${task.id}`)
      relations.add(key)
    }
    if (new Set(task.intent.primaryPath).size !== task.intent.primaryPath.length
      || task.intent.primaryPath.slice(1).some((node, i) => !relations.has(`${task.intent.primaryPath[i]}\0${node}`))) {
      throw new Error(`Primary reading path is not a verified directed chain in ${task.id}`)
    }
    const referenced = [...task.intent.nodes, ...task.intent.relations]
      .flatMap((item) => item.evidenceIds)
    if (referenced.some((ref) => !evidenceIds.has(ref))) throw new Error(`Unrecognized evidence reference in ${task.id}`)
    if (evidenceIds.size !== new Set(referenced).size) throw new Error(`Unused evidence in ${task.id}`)
    for (const evidence of task.evidence) {
      if (path.posix.isAbsolute(evidence.relativePath) || evidence.relativePath.includes('\\')
        || evidence.relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw new Error(`Unsafe evidence path in ${task.id}`)
      }
      const filename = path.resolve(root, evidence.relativePath)
      const actual = await realpath(filename)
      if (!actual.startsWith(root + path.sep)) throw new Error(`Evidence path escapes repository in ${task.id}`)
      if (!shaFile.has(actual)) {
        const content = await readFile(actual)
        if (content.byteLength > 2 * 1024 * 1024) throw new Error(`Evidence file too large in ${task.id}`)
        shaFile.set(actual, { sha256: createHash('sha256').update(content).digest('hex'),
          lineCount: content.toString('utf8').split(/\r?\n/).length })
      }
      const content = shaFile.get(actual)!
      if (content.sha256 !== evidence.fileSha256) {
        throw new Error(`Stale source evidence in ${task.id}: ${evidence.relativePath}`)
      }
      if (evidence.endLine < evidence.startLine || evidence.endLine > content.lineCount) {
        throw new Error(`Invalid source evidence lines in ${task.id}`)
      }
    }
    const review = approved.get(task.id)
    cases.push({
      id: task.id, repository: task.repository, purpose: task.purpose, readingGoal: task.readingGoal,
      intent: { title: task.intent.title,
        nodes: task.intent.nodes.map(({ evidenceIds: _ref, ...node }) => node),
        relations: task.intent.relations.map(({ evidenceIds: _ref, ...edge }) => edge),
        primaryPath: task.intent.primaryPath },
      evidenceDigest: manifestSha256,
      reviewAttested: review?.decision === 'approved',
      ...(review ? { reviewer: review.reviewer } : {}),
    })
  }
  return { manifestSha256, cases, pendingReview: cases.filter((task) => !task.reviewAttested).length }
}
