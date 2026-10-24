import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { boundArguments, inspectionDirectory, isModelTool, toolName } from '../../integrations/deepseek/bridge.mjs'

async function connect() {
  const client = new Client({ name: 'diagram-integration', version: '1.0.0' })
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [path.resolve('package/dist/server.mjs')], cwd: os.tmpdir(),
    env: { ...process.env, DIAGRAM_PLUGIN_HOST: 'deepseek' }, stderr: 'inherit',
  }))
  return client
}
function call(client, workspacePath, sessionId, name, args = {}) {
  return client.callTool({ name, arguments: args, _meta: { 'diagram/context': { host: 'deepseek', sessionId, workspacePath } } })
}

test('DeepSeek 适配拒绝跨工作区操作，模型不暴露面板内部工具', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-bridge-'))
  try {
    await mkdir(path.join(root, 'outside'))
    assert.equal((await boundArguments({}, root)).workspacePath, await realpath(root))
    await assert.rejects(boundArguments({ workspacePath: path.join(root, 'outside') }, root), /超出/)
    assert.equal(isModelTool({ _meta: { ui: { visibility: ['app'] } } }), false)
    assert.equal(isModelTool({}), true)
    assert.equal(toolName('diagram.proposeUpdate'), 'diagram_proposeUpdate')
    assert.equal(inspectionDirectory({ meta: { cwd: '/original' }, events: [{ type: 'working-directory/change', data: { cwd: '/changed' } }] }), '/changed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('真实 stdio 服务隔离会话与项目，缺失身份显式失败', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-sessions-'))
  const client = await connect()
  try {
    const first = path.join(root, 'first'), second = path.join(root, 'second')
    await Promise.all([mkdir(first), mkdir(second)])
    const a = await call(client, first, 'session-a', 'diagram.create', { type: 'flowchart', title: '项目甲' })
    const b = await call(client, second, 'session-b', 'diagram.create', { type: 'flowchart', title: '项目乙' })
    assert.equal(a.isError, undefined)
    assert.equal(b.isError, undefined)
    const aState = await call(client, first, 'session-a', 'diagram.threadState')
    const bState = await call(client, second, 'session-b', 'diagram.threadState')
    // Internal state uses the text bridge, exactly as the production editor does.
    assert.ok(JSON.stringify(aState).includes(a.structuredContent.diagram.path))
    assert.ok(!JSON.stringify(aState).includes(b.structuredContent.diagram.path))
    assert.ok(JSON.stringify(bState).includes(b.structuredContent.diagram.path))
    assert.equal((await client.callTool({ name: 'diagram.list', arguments: {} })).isError, true)
    assert.equal((await call(client, first, 'session-a', 'diagram.list', { workspacePath: first })).isError, undefined)
    assert.equal((await call(client, second, 'session-b', 'diagram.list', { workspacePath: first })).isError, true)
    assert.equal((await call(client, second, 'session-b', 'diagram.openWorkspace', { workspacePath: first })).isError, true)
    const visible = (await client.listTools()).tools.filter(isModelTool)
    assert.ok(visible.some((tool) => tool.name === 'diagram.create'))
    assert.ok(!visible.some((tool) => tool.name === 'diagram.applyProposal'))
    assert.ok(!visible.some((tool) => tool.name === 'diagram.restore'))
  } finally { await client.close(); await rm(root, { recursive: true, force: true }) }
})

test('架构语义图通过真实 MCP 一次生成、保存和质量评估', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-semantic-create-'))
  const client = await connect()
  try {
    const visible = (await client.listTools()).tools.filter(isModelTool)
    assert.ok(visible.some((tool) => tool.name === 'diagram.composeArchitecture'))
    const intent = {
      title: '后端系统架构',
      nodes: [
        { id: 'user', text: '客户端', icon: 'user' },
        { id: 'web', text: 'Web', icon: 'web' },
        { id: 'api', text: 'API 网关', icon: 'gateway' },
        { id: 'service', text: '核心服务', icon: 'service' },
        { id: 'db', text: 'Postgres', icon: 'database', stencil: 'postgres' },
        { id: 'cache', text: 'Redis', icon: 'cache', stencil: 'redis' },
      ],
      relations: [
        { from: 'user', to: 'web' }, { from: 'web', to: 'api' },
        { from: 'api', to: 'service' }, { from: 'service', to: 'db' },
        { from: 'service', to: 'cache' },
      ],
    }
    const created = await call(client, root, 'architecture-session', 'diagram.composeArchitecture', intent)
    assert.equal(created.isError, undefined)
    assert.equal(created.structuredContent.diagram.canvasWorkbench, 'architecture')
    assert.equal(created.structuredContent.quality.metrics.nodeOverlaps, 0)
    assert.ok(created.structuredContent.architectureEvaluation.candidates.length >= 2)
    assert.ok(['layered', 'hub-spoke', 'event-driven', 'data-platform', 'agent-runtime', 'cloud-native']
      .includes(created.structuredContent.architectureEvaluation.semanticComposition))
    assert.ok(created.structuredContent.architectureEvaluation.selected.structuralScore <= 90)
    assert.ok(created.structuredContent.presentationQuality.estimatedTitlePxAtFit > 0)
    assert.ok(created.structuredContent.architectureEvaluation.routeDiagnostics.crossPartitionRouteLength >= 0)
    assert.ok(Array.isArray(created.structuredContent.architectureEvaluation.routeDiagnostics.worstFrameIntrusions))
    assert.ok(created.structuredContent.architectureEvaluation.reroutedEdges >= 0)
    assert.equal((await readFile(path.join(root, created.structuredContent.diagram.path), 'utf8')).includes('arch-application'), true)
    assert.ok(JSON.stringify(await call(client, root, 'architecture-session', 'diagram.threadState')).includes(created.structuredContent.diagram.path))
    const wrong = await call(client, root, 'architecture-session', 'diagram.composeArchitecture', {
      ...intent, title: '未保存错误图', relations: [{ from: 'missing', to: 'api' }],
    })
    assert.equal(wrong.isError, true)
    assert.equal((await call(client, root, 'architecture-session', 'diagram.list')).structuredContent.diagrams.length, 1)
  } finally { await client.close(); await rm(root, { recursive: true, force: true }) }
})

test('两个服务进程竞争同一图表版本时只允许一个写入成功', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-processes-'))
  const clients = await Promise.all([connect(), connect()])
  try {
    const created = (await call(clients[0], root, 'session-a', 'diagram.create', { type: 'flowchart', title: '并发写入' })).structuredContent.diagram
    const sources = ['flowchart LR\n A-->B\n', 'flowchart LR\n A-->C\n']
    const results = await Promise.all(clients.map((client, index) => call(client, root, `session-${index}`, 'diagram.update', {
      path: created.path, source: sources[index], expectedModifiedAt: created.modifiedAt,
    })))
    assert.equal(results.filter((result) => !result.isError).length, 1)
    assert.match(JSON.stringify(results.find((result) => result.isError)), /已被其他编辑器修改/)
    assert.equal(await readFile(path.join(root, created.path), 'utf8'), sources[results.findIndex((result) => !result.isError)])
  } finally { await Promise.all(clients.map((client) => client.close())); await rm(root, { recursive: true, force: true }) }
})


test('候选修改属于原会话，接受前不写盘，确认后才保存', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-proposal-'))
  const client = await connect()
  try {
    const created = (await call(client, root, 'proposal-owner', 'diagram.create', { type: 'flowchart', title: '待确认修改' })).structuredContent.diagram
    const candidate = 'flowchart LR\n A-->Approved\n'
    const proposal = await call(client, root, 'proposal-owner', 'diagram.proposeUpdate', { path: created.path, source: candidate })
    assert.equal(proposal.isError, undefined)
    assert.equal(await readFile(path.join(root, created.path), 'utf8'), created.source)
    const approval = { expectedProposalRevision: proposal.structuredContent.proposal.revision }
    assert.equal((await call(client, root, 'other-session', 'diagram.applyProposal', approval)).isError, true)
    assert.equal((await call(client, root, 'proposal-owner', 'diagram.applyProposal', approval)).isError, undefined)
    assert.equal(await readFile(path.join(root, created.path), 'utf8'), candidate)
  } finally { await client.close(); await rm(root, { recursive: true, force: true }) }
})

test('会话切换工作目录后不能应用原项目的候选修改', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-directory-change-'))
  const client = await connect()
  try {
    const changed = path.join(root, 'changed')
    await mkdir(changed)
    const created = (await call(client, root, 'moving-session', 'diagram.create', { type: 'flowchart', title: '原项目候选' })).structuredContent.diagram
    const pending = await call(client, root, 'moving-session', 'diagram.proposeUpdate', { path: created.path, source: 'flowchart LR\n A-->Changed\n' })
    const applied = await call(client, changed, 'moving-session', 'diagram.applyProposal', { expectedProposalRevision: pending.structuredContent.proposal.revision })
    assert.equal(applied.isError, true)
    assert.equal(await readFile(path.join(root, created.path), 'utf8'), created.source)
  } finally { await client.close(); await rm(root, { recursive: true, force: true }) }
})

test('长期运行时按最近访问清理旧会话 Proposal，不删除已保存图表', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-session-cleanup-'))
  const client = await connect()
  try {
    const created = (await call(client, root, 'old-session', 'diagram.create', { type: 'flowchart', title: '保留文件' })).structuredContent.diagram
    const pending = await call(client, root, 'old-session', 'diagram.proposeUpdate', { path: created.path, source: 'flowchart LR\n A-->B\n' })
    for (let index = 0; index <= 512; index++) {
      const result = await call(client, root, `new-session-${index}`, 'diagram.threadState')
      assert.equal(result.isError, undefined)
    }
    assert.equal((await call(client, root, 'old-session', 'diagram.applyProposal', { expectedProposalRevision: pending.structuredContent.proposal.revision })).isError, true)
    assert.equal(await readFile(path.join(root, created.path), 'utf8'), created.source)
  } finally { await client.close(); await rm(root, { recursive: true, force: true }) }
})

test('接受和拒绝必须对应已审查的候选版本', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-proposal-revision-'))
  const client = await connect()
  try {
    const created = (await call(client, root, 'reviewer', 'diagram.create', { type: 'flowchart', title: '候选版本校验' })).structuredContent.diagram
    const first = await call(client, root, 'reviewer', 'diagram.proposeUpdate', { path: created.path, source: 'flowchart LR\n A-->First\n' })
    const second = await call(client, root, 'reviewer', 'diagram.proposeUpdate', { path: created.path, source: 'flowchart LR\n A-->Second\n' })
    const previousRevision = first.structuredContent.proposal.revision
    const currentRevision = second.structuredContent.proposal.revision
    const staleApply = await call(client, root, 'reviewer', 'diagram.applyProposal', { expectedProposalRevision: previousRevision })
    assert.equal(staleApply.isError, true)
    const staleDismiss = await call(client, root, 'reviewer', 'diagram.dismissProposal', { expectedProposalRevision: previousRevision })
    assert.equal(staleDismiss.isError, true)
    assert.equal(await readFile(path.join(root, created.path), 'utf8'), created.source)
    assert.equal((await call(client, root, 'reviewer', 'diagram.applyProposal')).isError, true)
    assert.equal((await call(client, root, 'reviewer', 'diagram.applyProposal', { expectedProposalRevision: currentRevision })).isError, undefined)
    assert.equal(await readFile(path.join(root, created.path), 'utf8'), 'flowchart LR\n A-->Second\n')
    const pending = await call(client, root, 'reviewer', 'diagram.proposeUpdate', { path: created.path, source: 'flowchart LR\n A-->Dismissed\n' })
    assert.equal((await call(client, root, 'reviewer', 'diagram.dismissProposal', { expectedProposalRevision: pending.structuredContent.proposal.revision })).isError, undefined)
    assert.equal((await call(client, root, 'reviewer', 'diagram.proposal')).isError, true)
  } finally { await client.close(); await rm(root, { recursive: true, force: true }) }
})

test('源码同步优先精确路径，拒绝有歧义的后缀', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-source-resolution-'))
  const client = await connect()
  try {
    for (const directory of ['aaa/src', 'src']) await mkdir(path.join(root, directory), { recursive: true })
    for (const file of ['aaa/src/service.ts', 'src/service.ts']) await writeFile(path.join(root, file), 'export const serviceName = "审批"\n')
    const created = (await call(client, root, 'source-owner', 'diagram.create', { type: 'canvas', title: '源码绑定' })).structuredContent.diagram
    const nested = await call(client, root, 'source-owner', 'diagram.upsertSourceNode', { path: created.path, sourcePath: 'aaa/src/service.ts' })
    const single = await call(client, root, 'source-owner', 'diagram.upsertSourceNode', { path: created.path, sourcePath: 'src/service.ts' })
    assert.equal(single.isError, undefined)
    assert.equal(single.structuredContent.sourcePath, 'src/service.ts')
    assert.notEqual(single.structuredContent.nodeId, nested.structuredContent.nodeId)
    const batch = await call(client, root, 'source-owner', 'diagram.upsertSourceNodes', { path: created.path, nodes: [{ sourcePath: './src/service.ts' }] })
    assert.equal(batch.isError, undefined)
    assert.equal(batch.structuredContent.nodes[0].sourcePath, 'src/service.ts')
    assert.equal(batch.structuredContent.nodes[0].nodeId, single.structuredContent.nodeId)
    const scene = JSON.parse(batch.structuredContent.diagram.source)
    scene.elements.find((element) => element.id === nested.structuredContent.nodeId).sourcePaths = [path.join(root, 'aaa/src/service.ts')]
    await call(client, root, 'source-owner', 'diagram.update', { path: created.path, source: JSON.stringify(scene) })
    const absolute = await call(client, root, 'source-owner', 'diagram.upsertSourceNodes', {
      path: created.path, nodes: [{ sourcePath: path.join(root, 'aaa/src/service.ts') }],
    })
    assert.equal(absolute.isError, undefined)
    assert.equal(absolute.structuredContent.nodes[0].nodeId, nested.structuredContent.nodeId)
    const before = await readFile(path.join(root, created.path), 'utf8')
    for (const name of ['diagram.upsertSourceNode', 'diagram.upsertSourceNodes']) {
      const args = name.endsWith('Nodes') ? { nodes: [{ sourcePath: 'service.ts' }] } : { sourcePath: 'service.ts' }
      const result = await call(client, root, 'source-owner', name, { path: created.path, ...args })
      assert.equal(result.isError, true)
      assert.match(JSON.stringify(result), /多个源码文件/)
    }
    assert.equal(await readFile(path.join(root, created.path), 'utf8'), before)
  } finally { await client.close(); await rm(root, { recursive: true, force: true }) }
})
