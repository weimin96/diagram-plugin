import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseCanvasScene } from '../src/canvas.js'
import { DiagramStore } from '../src/store.js'

test('图表列表按实际工作台标注系统架构、流程画布及自由画布', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plugin-workbench-label-'))
  try {
    const store = await DiagramStore.open(root)
    for (const [title, workbench] of [['系统架构', 'architecture'], ['流程画布', 'flowchart'], ['通用画布', 'freeform']] as const) {
      const created = await store.create('canvas', title, workbench)
      assert.equal(created.canvasWorkbench, workbench)
    }
    const diagrams = await store.list()
    assert.deepEqual(Object.fromEntries(diagrams.map(({ name, canvasWorkbench }) => [name, canvasWorkbench])), {
      系统架构: 'architecture', 流程画布: 'flowchart', 通用画布: 'freeform',
    })
    const architecture = diagrams.find((diagram) => diagram.name === '系统架构')!
    const file = JSON.parse((await store.get(architecture.path)).source)
    delete file.workbench
    await store.update(architecture.path, JSON.stringify(file))
    assert.equal((await store.list()).find((diagram) => diagram.path === architecture.path)?.canvasWorkbench, 'architecture')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('恢复删除的草稿保留源码，拒绝覆盖重建文件和越界目录', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-draft-recovery-'))
  try {
    const workspace = path.join(root, 'workspace')
    const outside = path.join(root, 'outside')
    await mkdir(workspace)
    await mkdir(outside)
    const store = await DiagramStore.open(workspace)
    const created = await store.create('flowchart', '审批草稿')
    await store.delete(created.path, created.modifiedAt)
    const draft = 'flowchart LR\n A[待确认草稿]-->B\n'
    const restored = await store.restore(created.path, draft)
    assert.equal(restored.source, draft)
    assert.equal(await readFile(path.join(workspace, created.path), 'utf8'), draft)
    await assert.rejects(store.restore(created.path, 'flowchart LR\n C-->D\n'), /原路径已存在/)
    assert.equal((await store.get(created.path)).source, draft)
    await symlink(outside, path.join(workspace, 'external'))
    await assert.rejects(store.restore('external/草稿.mmd', draft), /当前工作空间内/)
    await assert.rejects(store.restore('../outside/草稿.mmd', draft), /当前工作空间内/)
    assert.deepEqual(await readdir(outside), [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('同一版本的并发保存只能有一个成功，且保留完整文件', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plugin-concurrent-'))
  try {
    const store = await DiagramStore.open(root)
    const otherStore = await DiagramStore.open(root)
    const created = await store.create('flowchart', '并发编辑')
    const sources = ['flowchart LR\n A-->B\n', 'flowchart LR\n C-->D\n']
    const results = await Promise.allSettled(sources.map((source, index) =>
      (index ? otherStore : store).update(created.path, source, created.modifiedAt)))
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    const winner = results.findIndex((result) => result.status === 'fulfilled')
    assert.equal((await store.get(created.path)).source, sources[winner])
    assert.notEqual((await store.revision(created.path)).modifiedAt, created.modifiedAt)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('读取并发替换中的图表时，源码和版本来自同一个文件', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plugin-snapshot-'))
  try {
    const store = await DiagramStore.open(root)
    let before = await store.create('flowchart', '一致快照')
    for (let revision = 0; revision < 12; revision += 1) {
      const [snapshot, updated] = await Promise.all([
        store.get(before.path),
        store.update(before.path, `flowchart LR\n A-->N${revision}\n`, before.modifiedAt),
      ])
      assert.equal(snapshot.source, snapshot.modifiedAt === before.modifiedAt ? before.source : updated.source)
      assert.ok(snapshot.modifiedAt === before.modifiedAt || snapshot.modifiedAt === updated.modifiedAt)
      before = updated
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('创建、导出和图片导入拒绝指向工作区外的父目录，且不创建外部子目录', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plugin-boundary-'))
  try {
    const workspace = path.join(root, 'workspace')
    const outside = path.join(root, 'outside')
    await mkdir(workspace)
    await mkdir(outside)
    const store = await DiagramStore.open(workspace)
    const diagram = await store.create('canvas', '图片画布')
    await symlink(outside, path.join(workspace, 'docs', 'diagrams', 'assets'))
    await symlink(outside, path.join(workspace, 'docs', 'diagrams', 'exports'))
    await assert.rejects(() => store.importCanvasImage(diagram.path, '图片.png', 'image/png', new Uint8Array([1])), /当前工作空间内/)
    await assert.rejects(() => store.exportAsset('架构.svg', '<svg/>'), /当前工作空间内/)
    await rm(path.join(workspace, 'docs'), { recursive: true })
    await symlink(outside, path.join(workspace, 'docs'))
    await assert.rejects(() => store.create('flowchart', '越界'), /当前工作空间内/)
    await assert.rejects(() => readFile(path.join(outside, 'diagrams', '越界.mmd')), { code: 'ENOENT' })
    assert.deepEqual(await readdir(outside), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('creates, lists and updates a Mermaid diagram inside the workspace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plugin-'))
  try {
    const store = await DiagramStore.open(root)
    const created = await store.create('flowchart', 'API Flow')
    assert.equal(created.path, 'docs/diagrams/api-flow.mmd')
    assert.equal(created.type, 'flowchart')

    const listed = await store.list()
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.path, created.path)

    const updated = await store.update(created.path, 'sequenceDiagram\n  A->>B: ping')
    assert.equal(updated.type, 'sequence')
    assert.match(await readFile(path.join(root, created.path), 'utf8'), /sequenceDiagram/)

    const revision = await store.revision(created.path)
    assert.equal(revision.path, created.path)
    assert.equal(revision.modifiedAt, updated.modifiedAt)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects traversal and ignores diagrams in excluded directories', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plugin-'))
  try {
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(path.join(root, 'node_modules', 'pkg', 'hidden.mmd'), 'flowchart LR\n  A-->B\n')
    const store = await DiagramStore.open(root)
    assert.deepEqual(await store.list(), [])
    await assert.rejects(() => store.get('../outside.mmd'), /当前工作空间内/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects an update when the diagram changed after it was read', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plugin-'))
  try {
    const store = await DiagramStore.open(root)
    const created = await store.create('flowchart', 'Concurrent Edit')
    await new Promise((resolve) => setTimeout(resolve, 15))
    await writeFile(path.join(root, created.path), 'flowchart LR\n  External-->Change\n', 'utf8')

    await assert.rejects(
      () => store.update(created.path, 'flowchart LR\n  Local-->Change\n', created.modifiedAt),
      /其他编辑器修改/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('indexes source files without generated or dependency directories', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'diagram-plugin-sources-'))
  try {
    await mkdir(path.join(workspace, 'src', 'auth'), { recursive: true })
    await mkdir(path.join(workspace, 'node_modules', 'pkg'), { recursive: true })
    await mkdir(path.join(workspace, 'docs', 'diagrams'), { recursive: true })
    await writeFile(path.join(workspace, 'src', 'auth', 'LoginService.java'), 'class LoginService {}')
    await writeFile(path.join(workspace, 'src', 'app.ts'), 'export {}')
    await writeFile(path.join(workspace, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}')
    await writeFile(path.join(workspace, 'docs', 'diagrams', 'existing.mmd'), 'flowchart LR\n A --> B\n')

    const store = await DiagramStore.open(workspace)
    const files = await store.listSourceFiles()
    assert.deepEqual(files, ['src/app.ts', 'src/auth/LoginService.java'])
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('renames, duplicates and deletes diagrams without losing source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plugin-actions-'))
  try {
    const store = await DiagramStore.open(root)
    const created = await store.create('flowchart', 'Checkout Flow')
    const source = 'flowchart LR\n  Cart --> Pay\n'
    const updated = await store.update(created.path, source, created.modifiedAt)

    const renamed = await store.rename(updated.path, 'Payment Flow', updated.modifiedAt)
    assert.equal(renamed.path, 'docs/diagrams/payment-flow.mmd')
    assert.equal(renamed.source, source)
    await assert.rejects(() => store.get(created.path), /图表不存在/)

    const duplicated = await store.duplicate(renamed.path)
    assert.equal(duplicated.path, 'docs/diagrams/payment-flow-copy.mmd')
    assert.equal(duplicated.source, source)

    const deleted = await store.delete(duplicated.path, duplicated.modifiedAt)
    assert.equal(deleted, duplicated.path)
    assert.deepEqual((await store.list()).map((item) => item.path), [renamed.path])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('exports SVG and PNG assets without overwriting previous exports', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plugin-export-'))
  try {
    const store = await DiagramStore.open(root)
    const firstSvg = await store.exportAsset('System Overview.svg', '<svg />')
    const secondSvg = await store.exportAsset('System Overview.svg', '<svg>2</svg>')
    const png = await store.exportAsset('System Overview.png', new Uint8Array([137, 80, 78, 71]))

    assert.equal(firstSvg, 'docs/diagrams/exports/system-overview.svg')
    assert.equal(secondSvg, 'docs/diagrams/exports/system-overview-2.svg')
    assert.equal(png, 'docs/diagrams/exports/system-overview.png')
    assert.equal(await readFile(path.join(root, firstSvg), 'utf8'), '<svg />')
    assert.deepEqual([...await readFile(path.join(root, png))], [137, 80, 78, 71])
    await assert.rejects(() => store.exportAsset('../escape.png', new Uint8Array([1])), /文件名无效/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('persists Canvas image assets inside the diagram asset directory and reads them back safely', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plugin-image-'))
  try {
    const store = await DiagramStore.open(root)
    const diagram = await store.create('canvas', 'Image Board', 'freeform')
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const imported = await store.importCanvasImage(diagram.path, 'Screen Shot.png', 'image/png', bytes)
    assert.match(imported.path, /^docs\/diagrams\/assets\/screen-shot-[a-f0-9]{8}\.png$/)
    assert.equal(imported.mimeType, 'image/png')
    const loaded = await store.readCanvasImage(imported.path)
    assert.equal(loaded.mimeType, 'image/png')
    assert.deepEqual([...loaded.content], [...bytes])
    await assert.rejects(() => store.readCanvasImage('docs/diagrams/image-board.diagram.json'), /当前工作空间内/)
    await assert.rejects(() => store.importCanvasImage(diagram.path, 'icon.svg', 'image/svg+xml', bytes), /只支持 PNG、JPEG 和 WebP/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('creates and manages freeform Canvas diagrams beside Mermaid files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plugin-canvas-'))
  try {
    const store = await DiagramStore.open(root)
    const canvas = await store.create('canvas', 'Service Landscape')
    assert.equal(canvas.path, 'docs/diagrams/service-landscape.diagram.json')
    assert.equal(canvas.type, 'canvas')
    assert.equal(parseCanvasScene(canvas.source).elements.length, 0)

    const architecture = await store.create('canvas', 'Architecture Board', 'architecture')
    assert.equal(parseCanvasScene(architecture.source).workbench, 'architecture')
    assert.equal(parseCanvasScene(architecture.source).elements.length, 0)

    const mermaid = await store.create('sequence', 'Request Flow')
    assert.deepEqual(new Set((await store.list()).map((item) => item.type)), new Set(['canvas', 'sequence']))

    const renamed = await store.rename(canvas.path, 'Platform Canvas', canvas.modifiedAt)
    assert.equal(renamed.path, 'docs/diagrams/platform-canvas.diagram.json')
    const duplicated = await store.duplicate(renamed.path)
    assert.equal(duplicated.path, 'docs/diagrams/platform-canvas-copy.diagram.json')
    assert.equal(duplicated.type, 'canvas')

    const sourceFiles = await store.listSourceFiles()
    assert.ok(!sourceFiles.includes(renamed.path))
    assert.ok(!sourceFiles.includes(duplicated.path))
    assert.ok(!sourceFiles.includes(mermaid.path))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
