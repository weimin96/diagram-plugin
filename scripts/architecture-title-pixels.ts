/** Browser-pixel geometry gate for plain architecture node titles.
 * Unlike heuristic text-length checks, this reads real SVG getBBox() after
 * Chromium has resolved fonts. It is opt-in, separate from subjective ratings.
 */
import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const directory = path.resolve(arg('dir') ?? 'test-results/architecture-design-project')
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as {
  cases: Array<{ id: string; svg: string }>
}
const requested = arg('case')
const cases = requested ? manifest.cases.filter((item) => item.id === requested) : manifest.cases
if (!cases.length) throw new Error('No matching architecture visual cases')
const candidates = [process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].filter((item): item is string => Boolean(item))
const chrome = (await Promise.all(candidates.map(async (candidate) =>
  await access(candidate).then(() => candidate, () => undefined)))).find(Boolean)
if (!chrome) throw new Error('Real SVG text bounds require a local Chrome/Chromium executable')

const results = []
for (const sample of cases) {
  if (!/^[a-zA-Z0-9_-]+$/.test(sample.id)) throw new Error('Unsafe benchmark case ID')
  const scene = JSON.parse(await readFile(path.join(directory, `${sample.id}.diagram.json`), 'utf8')) as {
    elements: Array<{ id: string; type: string; text?: string; x?: number; y?: number;
      width?: number; height?: number; icon?: string; stencil?: string; iconRef?: string; c4Type?: string }>
  }
  const nodes = scene.elements.filter((element) => element.type === 'node'
    && !element.icon && !element.stencil && !element.iconRef && !element.c4Type)
    .map((element) => ({
      id: element.id, title: element.text, x: element.x, y: element.y, width: element.width, height: element.height,
    }))
  const svg = await readFile(path.join(directory, sample.svg), 'utf8')
  const temp = await mkdtemp(path.join(os.tmpdir(), 'diagram-title-pixels-'))
  try {
    const html = `<!doctype html><meta charset="utf-8"><main>${svg}</main><pre id="metrics"></pre><script>
      window.addEventListener('load', () => {
        const nodes = ${JSON.stringify(nodes).replace(/</g, '\\u003c')}
        const lines = [...document.querySelectorAll('svg text[font-size="15"][text-anchor="middle"]')]
          .map((el) => {
            const x = Number(el.getAttribute('x')), y = Number(el.getAttribute('y'))
            const node = nodes.find((n) =>
              Math.abs(n.x + n.width / 2 - x) <= .5 && y >= n.y && y <= n.y + n.height)
            if (!node) return null
            const rect = el.getBBox()
            const padding = 5
            return {
              nodeId: node.id, line: el.textContent,
              bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              outside: rect.x < node.x + padding || rect.x + rect.width > node.x + node.width - padding
                || rect.y < node.y + padding || rect.y + rect.height > node.y + node.height - padding,
            }
          }).filter(Boolean)
        const report = JSON.stringify({ labelsMeasured: lines.length,
          overflowing: lines.filter((line) => line.outside),
          unmatchedNodeIds: nodes.filter((node) => !lines.some((line) => line.nodeId === node.id))
            .map((node) => node.id),
        })
        const bytes = new TextEncoder().encode(report)
        document.getElementById('metrics').textContent = btoa(String.fromCharCode(...bytes))
      })
      </script>`
    const entry = path.join(temp, 'inspect.html')
    await writeFile(entry, html)
    const { stdout } = await promisify(execFile)(chrome, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
      `--user-data-dir=${path.join(temp, 'chrome')}`,
      '--virtual-time-budget=1500', '--dump-dom', pathToFileURL(entry).href,
    ], { timeout: 30000, maxBuffer: 8_000_000 })
    const encoded = stdout.match(/<pre id="metrics">([A-Za-z0-9+/=]+)<\/pre>/)?.[1]
    if (!encoded) throw new Error('Chrome did not return measured SVG text bounds')
    results.push({ id: sample.id, ...JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as {
      labelsMeasured: number; overflowing: unknown[]; unmatchedNodeIds: string[]
    } })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}
const report = {
  kind: 'architecture-chrome-title-bounds', version: 1,
  note: 'Measured only plain architecture SVG node titles at 15px; missing/LOD-collapsed nodes are reported but not treated as overflowing.',
  cases: results,
}
await writeFile(path.join(directory, 'title-pixel-bounds.json'), JSON.stringify(report, null, 2) + '\n')
console.log('CHROME_TITLE_BOUNDS', JSON.stringify(results.map(({ id, labelsMeasured, overflowing, unmatchedNodeIds }) =>
  ({ id, labelsMeasured, overflowing: overflowing.length, unmatchedNodeIds }))))
if (process.argv.includes('--fail-on-overflow') && results.some((item) => item.overflowing.length)) {
  console.error('Rendered plain architecture titles overflow their real node bounds')
  process.exitCode = 1
}
