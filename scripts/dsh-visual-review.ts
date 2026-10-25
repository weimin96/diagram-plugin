/** DeepSeek Harness's JSONL read_image transport.
 * A final textual claim to have seen pixels is NOT enough: an actual successful
 * image-bearing tool result must be present in the matching invocation.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'

export interface DshPixelAssessment {
  ratings: Record<string, { score: number; evidence: string }>
  summary: string
  issues: Array<{ observation: string; suggestedFix: string }>
}

type DshEvent = {
  type?: string
  tool?: string
  callId?: string
  status?: string
  input?: { file_path?: string }
  result?: string
  text?: string
}

function normalizeMacTmp(value: string) {
  return path.normalize(value).replace(/^\/private(?=\/tmp\/)/, '')
}

/** Only accept the image file that was just copied to the isolated working
 * directory; extra tools or a text-only reply disqualify the review.
 */
export function parseDshPixelAssessment(
  jsonl: string, cwd: string, expectedImage = 'anonymous.png',
): DshPixelAssessment {
  let events: DshEvent[]
  try {
    events = jsonl.trim().split(/\r?\n/).map((line) => JSON.parse(line) as DshEvent)
  } catch {
    throw new Error('DeepSeek Harness did not return valid JSONL events')
  }
  const toolCalls = events.filter((event) => event.type === 'tool_call')
  if (toolCalls.length !== 1 || toolCalls[0].tool !== 'read_image' || !toolCalls[0].callId) {
    throw new Error('Visual review requires exactly one read_image tool call and no other tools')
  }
  const input = toolCalls[0].input?.file_path
  if (!input || normalizeMacTmp(path.resolve(cwd, input))
    !== normalizeMacTmp(path.resolve(cwd, expectedImage))) {
    throw new Error('read_image did not target the isolated current screenshot')
  }
  const match = events.find((event) => event.type === 'tool_result' && event.callId === toolCalls[0].callId)
  if (!match || match.status !== 'completed'
    || typeof match.result !== 'string'
    || !/<type>image<\/type>/.test(match.result)
    || !/image\/(?:png|jpeg|webp) image,\s*\d+x\d+ px/.test(match.result)) {
    throw new Error('DeepSeek Harness has no successful image-pixel tool result')
  }
  const final = events.filter((event) => event.type === 'final')
  if (final.length !== 1 || typeof final[0].text !== 'string') {
    throw new Error('DeepSeek Harness did not produce one final image review')
  }
  const answer = final[0].text.trim().replace(/^\`\`\`(?:json)?\s*\n?|\n?\`\`\`$/g, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(answer)
  } catch {
    throw new Error('DeepSeek Harness image review must be valid JSON, not explanatory prose')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('DeepSeek Harness review must be a JSON object')
  }
  const value = parsed as DshPixelAssessment
  if (!value.ratings || typeof value.ratings !== 'object'
    || typeof value.summary !== 'string' || !Array.isArray(value.issues)) {
    throw new Error('DeepSeek Harness review does not match the required rating contract')
  }
  return value
}

export async function runDshPixelAssessment(
  cwd: string, prompt: string, executable = 'dsh', timeoutMs = 180_000,
): Promise<DshPixelAssessment> {
  const child = spawn(executable, ['headless', '--json', prompt], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let exceededLimit = false
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
    if (stdout.length > 8_000_000) {
      exceededLimit = true
      child.kill('SIGTERM')
    }
  })
  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-1600) })
  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeoutMs)
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (value) => resolve(value ?? 1))
  }).finally(() => clearTimeout(timeout))
  if (timedOut || exceededLimit || code) {
    throw new Error(`DeepSeek Harness failed: ${timedOut ? 'timeout' : exceededLimit
      ? 'oversized JSONL event stream' : stderr.slice(-450) || `exit ${code}`}`)
  }
  return parseDshPixelAssessment(stdout, cwd)
}
