import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'

const LIMIT = 300
const folders = [
  { path: 'tests', extension: '.test.ts', category: 'unit' },
  { path: 'tests/integration', extension: '.test.mjs', category: 'host' },
]
const totals = { unit: 0, host: 0 }

for (const folder of folders) {
  for (const name of (await readdir(folder.path)).filter((name) => name.endsWith(folder.extension))) {
    const filename = join(folder.path, name)
    const source = await readFile(filename, 'utf8')
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
      folder.extension === '.test.mjs' ? ts.ScriptKind.JS : ts.ScriptKind.TS)
    // Include nested/subtests and skipped cases so the cap is not bypassed
    // by moving registrations into a describe block or callback.
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        const name = ts.isIdentifier(callee) ? callee.text
          : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
        if (name === 'test' || name === 'it') totals[folder.category]++
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
}
const total = totals.unit + totals.host
console.log(`Test budget: ${totals.unit} unit + ${totals.host} host = ${total}/${LIMIT}`)
if (total > LIMIT) {
  console.error('Test budget exceeded. Consolidate redundant cases without losing essential assertions.')
  process.exitCode = 1
}
