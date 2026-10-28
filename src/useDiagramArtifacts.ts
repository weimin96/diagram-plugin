import { errorMessage } from './errors.js'
import { callTool, host } from './hostRuntime.js'
import { canvasSceneToSvg, parseCanvasScene } from './canvas.js'
import { createSafeSvgElement, renderMermaidSvg, resolveCssColor } from './mermaidRender.js'
import type { DiagramCapability } from './diagramCapabilities.js'
import type { DiagramDocument } from './types.js'

export interface DiagramExportResult {
  kind: 'diagram-export'
  workspacePath: string
  path: string
}

export interface DiagramImageAssetResult {
  kind: 'diagram-image-asset'
  workspacePath: string
  path: string
  mimeType: string
}

export interface DiagramImageAssetContentResult {
  kind: 'diagram-image-asset-content'
  workspacePath: string
  path: string
  mimeType: string
  content: string
}

async function renderCanvasSvg(source: string, workspacePath: string): Promise<string> {
  const scene = parseCanvasScene(source)
  const imagePaths = [...new Set(scene.elements.flatMap((item) => item.type === 'note' && item.imagePath ? [item.imagePath] : []))]
  const imageSources = Object.fromEntries(await Promise.all(imagePaths.map(async (path) => {
    const result = await callTool<DiagramImageAssetContentResult>('diagram.readImageAsset', { workspacePath, path })
    return [path, `data:${result.mimeType};base64,${result.content}`] as const
  })))
  return canvasSceneToSvg(scene, {
    background: resolveCssColor('--app-bg', '#ffffff'),
    panel: resolveCssColor('--surface-raised', '#f5f5f5'),
    text: resolveCssColor('--text-primary', '#171717'),
    border: resolveCssColor('--border-strong', '#8a8a8a'),
    note: '#fff4b8',
    imageSources,
  })
}

async function svgToPngBase64(svg: string, background: string): Promise<string> {
  const root = createSafeSvgElement(svg)
  const normalizedSvg = new XMLSerializer().serializeToString(root)
  const viewBox = root.getAttribute('viewBox')?.trim().split(/\s+/).map(Number)
  const sourceWidth = viewBox?.length === 4 && Number.isFinite(viewBox[2])
    ? Math.max(1, viewBox[2])
    : Math.max(1, Number.parseFloat(root.getAttribute('width') || '1200'))
  const sourceHeight = viewBox?.length === 4 && Number.isFinite(viewBox[3])
    ? Math.max(1, viewBox[3])
    : Math.max(1, Number.parseFloat(root.getAttribute('height') || '800'))
  const scale = Math.min(2, 8192 / sourceWidth, 8192 / sourceHeight)
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  // MCP Apps run under a restrictive CSP. A blob: URL can be rejected by the
  // host even though the SVG was produced locally, while an inline data URL
  // remains self-contained and needs no resource-domain permission.
  const imageUrl = `data:image/svg+xml;base64,${utf8ToBase64(normalizedSvg)}`
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('浏览器无法载入 Mermaid SVG。'))
    image.src = imageUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器不支持 PNG 画布导出。')
  context.fillStyle = background
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG 编码失败。')), 'image/png')
  })
  return blobToBase64(png)
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    binary += String.fromCharCode(...buffer.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function safeFilename(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'diagram'
}

function resolveWorkspaceFilePath(root: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.')
  if (normalized.some((part) => part === '..')) throw new Error('图表路径超出当前工作空间。')
  const windowsRoot = /^[A-Za-z]:[\\/]/.test(root) || root.includes('\\')
  const separator = windowsRoot ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${separator}${normalized.join(separator)}`
}

export function cleanMermaidError(value: string): string {
  return value.replace(/^Error:\s*/i, '').split('\n').slice(0, 3).join(' ').trim()
}

export interface DiagramArtifactsDeps {
  workspacePath: string
  selected: DiagramDocument | null
  source: string
  capability: DiagramCapability
  exporting: boolean
  setExporting: (value: boolean) => void
  setError: (message: string | null) => void
  setNotice: (message: string) => void
}

export interface DiagramArtifacts {
  exportSvg: () => Promise<void>
  exportPng: () => Promise<void>
  importCanvasImage: (input: { filename: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; content: string }) => Promise<DiagramImageAssetResult>
  resolveCanvasImage: (path: string) => Promise<string>
  openDiagramFile: () => Promise<void>
  openWorkspaceSource: (path: string) => Promise<void>
}

/** Getting a diagram out of the panel: export, image assets, native file open. */
export function useDiagramArtifacts(deps: DiagramArtifactsDeps): DiagramArtifacts {
  const { workspacePath, selected, source, capability, exporting, setExporting, setError, setNotice } = deps

  async function importCanvasImage(input: { filename: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; content: string }) {
    if (!selected || !capability.visualEdit) throw new Error('只有 Canvas 图支持图片资源。')
    return callTool<DiagramImageAssetResult>('diagram.importImageAsset', {
      workspacePath,
      path: selected.path,
      ...input,
    })
  }

  async function resolveCanvasImage(path: string): Promise<string> {
    const result = await callTool<DiagramImageAssetContentResult>('diagram.readImageAsset', { workspacePath, path })
    return `data:${result.mimeType};base64,${result.content}`
  }

  async function exportSvg() {
    if (!selected || exporting) return
    setExporting(true)
    setError(null)
    try {
      const svg = capability.visualEdit
        ? await renderCanvasSvg(source, workspacePath)
        : await renderMermaidSvg(source, `export-${Date.now()}`)
      const filename = `${safeFilename(selected.name)}.svg`
      const destination = await deliverExport(filename, 'svg', svg)
      setNotice(`已导出 ${destination}`)
    } catch (cause) {
      setError(cleanMermaidError(errorMessage(cause)))
    } finally {
      setExporting(false)
    }
  }

  async function exportPng() {
    if (!selected || exporting) return
    setExporting(true)
    setError(null)
    try {
      const svg = capability.visualEdit
        ? await renderCanvasSvg(source, workspacePath)
        : await renderMermaidSvg(source, `export-png-${Date.now()}`)
      const blob = await svgToPngBase64(svg, resolveCssColor('--app-bg', '#ffffff'))
      const filename = `${safeFilename(selected.name)}.png`
      const destination = await deliverExport(filename, 'png', blob)
      setNotice(`已导出 ${destination}`)
    } catch (cause) {
      setError(cleanMermaidError(errorMessage(cause)))
    } finally {
      setExporting(false)
    }
  }

  async function deliverExport(filename: string, format: 'svg' | 'png', content: string): Promise<string> {
    if (host.downloadFile) {
      const result = format === 'svg'
        ? await host.downloadFile({
            contents: [{
              type: 'resource',
              resource: {
                uri: `file:///${encodeURIComponent(filename)}`,
                mimeType: 'image/svg+xml',
                text: content,
              },
            }],
          })
        : await host.downloadFile({
            contents: [{
              type: 'resource',
              resource: {
                uri: `file:///${encodeURIComponent(filename)}`,
                mimeType: 'image/png',
                blob: content,
              },
            }],
          })
      if (result.isError) throw new Error('宿主取消或拒绝了文件导出。')
      return filename
    }

    const result = await callTool<DiagramExportResult>('diagram.exportAsset', {
      workspacePath,
      filename,
      format,
      content,
    })
    return result.path
  }

  async function openDiagramFile() {
    if (!selected) return
    const fileApi = host.files
    if (!fileApi) {
      setError('当前宿主没有提供原生文件打开能力。')
      return
    }
    try {
      await fileApi.open(resolveWorkspaceFilePath(workspacePath, selected.path))
    } catch (cause) {
      setError(`打开图表文件失败：${errorMessage(cause)}`)
    }
  }

  async function openWorkspaceSource(path: string) {
    const fileApi = host.files
    if (!fileApi) {
      setError('当前宿主没有提供原生文件打开能力。')
      return
    }
    try {
      await fileApi.open(resolveWorkspaceFilePath(workspacePath, path))
    } catch (cause) {
      setError(`打开源码失败：${errorMessage(cause)}`)
    }
  }

  return { importCanvasImage, resolveCanvasImage, exportSvg, exportPng, openDiagramFile, openWorkspaceSource }
}
