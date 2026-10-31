let labelContext: CanvasRenderingContext2D | undefined
const labelTextLayouts = new Map<string, { lines: string[]; width: number; height: number }>()

function measureLabelText(text: string, fontSize = 12, fontWeight = 600): number {
  if (typeof document === 'undefined') {
    // 服务端无浏览器字体，按全角和半角估算；预览与导出使用实际字形宽度。
    return Array.from(text).reduce((width, char) => {
      const code = char.codePointAt(0)!
      if (code > 255) return width + fontSize
      if (char === ' ') return width + fontSize * 0.34
      if (/[A-Z0-9]/.test(char)) return width + fontSize * 0.64
      return width + fontSize * 0.56
    }, 0)
  }
  if (!labelContext) {
    const context = document.createElement('canvas').getContext('2d')
    if (!context) throw new Error('无法测量图表关系标签。')
    labelContext = context
  }
  labelContext.font = `${fontWeight} ${fontSize}px Arial, sans-serif`
  return labelContext.measureText(text).width
}

/** Keep a node title or subtitle inside its card. Adds an ellipsis only when
 * the measured text would leave the available width. */
export function fitCanvasText(text: string, maxWidth: number, fontSize: number, fontWeight = 600): string {
  if (!text) return text
  if (measureLabelText(text, fontSize, fontWeight) <= maxWidth) return text
  const chars = Array.from(text)
  let low = 1
  let high = chars.length - 1
  let best = 0
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = `${chars.slice(0, middle).join('').trimEnd()}…`
    if (measureLabelText(candidate, fontSize, fontWeight) <= maxWidth) {
      best = middle
      low = middle + 1
    } else high = middle - 1
  }
  return best > 0 ? `${chars.slice(0, best).join('').trimEnd()}…` : '…'
}

/** Shared editor/export typography for the actual space inside a card.
 * Prioritize a complete title over subtitle detail; no automatic font shrinking.
 */
export function layoutArchitectureCardText(
  title: string, subtitle: string | undefined, width: number, height: number,
  fontSize = 14, fontWeight = 650,
): {
  titleLines: string[]
  subtitleLines: string[]
  titleFontSize: number
  subtitleFontSize: number
  titleY: number
  subtitleY: number
  titleLineHeight: number
  subtitleLineHeight: number
  truncated: boolean
} {
  const titleFontSize = Math.max(13, fontSize)
  const subtitleFontSize = Math.max(11, Math.min(12, titleFontSize * 0.8))
  const titleLineHeight = Math.ceil(titleFontSize * 1.22)
  const subtitleLineHeight = Math.ceil(subtitleFontSize * 1.22)
  const usableWidth = Math.max(28, width)
  const wrap = (value: string, size: number, weight: number, limit: number) => {
    const lines: string[] = []
    let remaining = Array.from(value.replace(/\s+/g, ' ').trim())
    let truncated = false
    while (remaining.length && lines.length < limit) {
      let count = 0
      while (count < remaining.length && measureLabelText(remaining.slice(0, count + 1).join(''), size, weight) <= usableWidth) count++
      count = Math.max(1, count)
      if (count >= remaining.length) {
        lines.push(remaining.join(''))
        remaining = []
        break
      }
      // Preserve a complete Latin technical name on the next line when it
      // fits there (e.g. '容器平台 Kubernetes'), not 'Kube' / 'rnetes'.
      const separator = remaining.slice(0, count).lastIndexOf(' ')
      const nextWord = separator > 0 ? remaining.slice(separator + 1).join('').split(' ')[0] : ''
      const wholeWordFits = /^[A-Za-z0-9][A-Za-z0-9._/+-]*$/.test(nextWord)
        && measureLabelText(nextWord, size, weight) <= usableWidth
      if (separator > 0 && (separator >= count / 2 || wholeWordFits)) count = separator + 1
      lines.push(remaining.slice(0, count).join('').trim())
      remaining = remaining.slice(count).filter((char, i) => i !== 0 || char !== ' ')
    }
    if (remaining.length) {
      truncated = true
      lines[lines.length - 1] = fitCanvasText(lines[lines.length - 1] + remaining.join(''), usableWidth, size, weight)
    }
    return { lines, truncated }
  }
  const titleText = wrap(title, titleFontSize, fontWeight, 2)
  const availableHeight = height - 10
  const titleHeight = titleText.lines.length * titleLineHeight
  const subtitleLineBudget = subtitle && availableHeight - titleHeight - 3 >= subtitleLineHeight
    ? Math.min(2, Math.floor((availableHeight - titleHeight - 3) / subtitleLineHeight))
    : 0
  const subtitleText = subtitle && subtitleLineBudget
    ? wrap(subtitle, subtitleFontSize, 500, subtitleLineBudget) : { lines: [], truncated: Boolean(subtitle) }
  const totalHeight = titleHeight + (subtitleText.lines.length ? 3 + subtitleText.lines.length * subtitleLineHeight : 0)
  const titleY = Math.max(5, (height - totalHeight) / 2) + titleFontSize
  const subtitleY = titleY + (titleText.lines.length - 1) * titleLineHeight + 3 + subtitleLineHeight
  return {
    titleLines: titleText.lines,
    subtitleLines: subtitleText.lines,
    titleFontSize, subtitleFontSize, titleY, subtitleY,
    titleLineHeight, subtitleLineHeight,
    truncated: titleText.truncated || subtitleText.truncated,
  }
}

export function canvasArrowLabelText(label: string): { lines: string[]; width: number; height: number } {
  const cached = labelTextLayouts.get(label)
  if (cached) return cached
  let remaining = Array.from(label.replace(/\s+/g, ' ').trim())
  const lines: string[] = []
  const totalWidth = measureLabelText(remaining.join(''))
  const firstLineWidth = totalWidth > 200 ? Math.min(200, totalWidth / 2 + 6) : 200
  while (remaining.length && lines.length < 2) {
    let length = 0
    while (length < remaining.length && measureLabelText(remaining.slice(0, length + 1).join('')) <= (lines.length ? 200 : firstLineWidth)) length += 1
    if (length === remaining.length) {
      lines.push(remaining.join(''))
      break
    }
    if (lines.length === 1) {
      while (length > 0 && measureLabelText(`${remaining.slice(0, length).join('')}…`) > 200) length -= 1
      lines.push(`${remaining.slice(0, length).join('').trimEnd()}…`)
      break
    }
    const wordBoundary = remaining.slice(0, length).lastIndexOf(' ')
    const consumed = wordBoundary > 0 ? wordBoundary + 1 : Math.max(1, length)
    lines.push(remaining.slice(0, consumed).join('').trimEnd())
    remaining = remaining.slice(consumed)
  }
  if (!lines.length) lines.push('')
  const layout = {
    lines,
    width: Math.max(48, Math.ceil(Math.max(...lines.map((line) => measureLabelText(line)))) + 18),
    height: lines.length * 16 + 8,
  }
  if (labelTextLayouts.size >= 512) labelTextLayouts.delete(labelTextLayouts.keys().next().value!)
  labelTextLayouts.set(label, layout)
  return layout
}
