import { canvasGroupFrames, type CanvasNode, type CanvasScene } from '../src/canvas.js'
import { routeArchitectureEdges } from '../src/architectureRouting.js'

/** Isolated generated-architecture experiment, never a saved-document edit.
 * Move entire sibling regions as rigid bodies, keeping internal geometry and
 * all real relations; only re-route after the final group placements settle.
 * All candidates require full editable-scene quality and fidelity gates. */
export function proposePartitionEnvelopeLayout(scene: CanvasScene, axis: 'horizontal' | 'vertical' | 'least-growth'): CanvasScene | null {
  if (scene.workbench !== 'architecture' || scene.elements.some((e) => e.type === 'note'
    || (e.type === 'node' && e.locked))) return null
  const nodes = scene.elements.filter((e): e is CanvasNode => e.type === 'node')
  if (!nodes.length || nodes.some((e) => !e.groupId || !e.groupId.startsWith('arch-'))
    || scene.lanes?.length) return null
  const groupById = new Map((scene.groups ?? []).map((g) => [g.id, g]))
  const frames = canvasGroupFrames(scene).filter((f) => !f.collapsed && f.memberIds.length
    && f.kind === 'boundary' && f.id.startsWith('arch-') && nodes.some((n) => n.groupId === f.id)
    && ![...groupById.values()].some((g) => g.parentId === f.id))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id, 'en'))
  if (frames.length < 2) return null
  if (new Set(nodes.map((node) => node.groupId)).size !== frames.length) return null
  // This constrained prototype only accepts siblings; nested frames require
  // an actual hierarchy-aware planner, never silent user-group rewriting.
  if (new Set(frames.map((f) => groupById.get(f.id)?.parentId ?? '')).size !== 1) return null
  if (!frames.some((frame, index) => frames.slice(index + 1).some((other) =>
    Math.min(frame.x + frame.width, other.x + other.width) - Math.max(frame.x, other.x) > 5
    && Math.min(frame.y + frame.height, other.y + other.height) - Math.max(frame.y, other.y) > 5))) return null
  const margin = 12
  const placed: typeof frames = []
  const motions = new Map<string, { dx: number; dy: number }>()
  for (const frame of frames) {
    let x = frame.x, y = frame.y
    for (let i = 0; i < frames.length * 2; i++) {
      const hits = placed.filter((other) => x < other.x + other.width + margin && x + frame.width + margin > other.x
        && y < other.y + other.height + margin && y + frame.height + margin > other.y)
      if (!hits.length) break
      const nextX = Math.max(...hits.map((other) => other.x + other.width + margin))
      const nextY = Math.max(...hits.map((other) => other.y + other.height + margin))
      if (axis === 'horizontal') x = nextX
      else if (axis === 'vertical') y = nextY
      else {
        const extX = Math.max(scene.width, nextX + frame.width + 24)
        const extY = Math.max(scene.height, nextY + frame.height + 24)
        const costX = extX * Math.max(scene.height, y + frame.height + 24)
        const costY = Math.max(scene.width, x + frame.width + 24) * extY
        if (costX < costY || (costX === costY && nextX - x < nextY - y)) x = nextX
        else y = nextY
      }
    }
    if (placed.some((other) => x < other.x + other.width + margin && x + frame.width + margin > other.x
      && y < other.y + other.height + margin && y + frame.height + margin > other.y)) return null
    placed.push({ ...frame, x, y })
    motions.set(frame.id, { dx: x - frame.x, dy: y - frame.y })
  }
  if (![...motions.values()].some(({ dx, dy }) => dx || dy)) return null
  const moved: CanvasScene = {
    ...scene,
    elements: scene.elements.map((item) => {
      if (item.type !== 'node') return item
      const change = motions.get(item.groupId ?? '')
      return change ? { ...item, x: item.x + change.dx, y: item.y + change.dy } : item
    }),
  }
  const adjustedFrames = canvasGroupFrames(moved)
  const width = Math.max(scene.width, ...adjustedFrames.map((f) => f.x + f.width + 24))
  const height = Math.max(scene.height, ...adjustedFrames.map((f) => f.y + f.height + 24))
  return routeArchitectureEdges({ ...moved, width, height })
}
