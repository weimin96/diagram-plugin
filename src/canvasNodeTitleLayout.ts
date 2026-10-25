/** Geometry-aware title lines for plain architecture nodes.
 * Shared by SVG export and the live editor. The Canvas title stays unchanged;
 * no characters are omitted to make a score improve.
 */
export function canvasArchitecturePlainTitleLines(
  title: string, width: number, height: number,
  fontFamily: 'monospace' | 'sans' = 'sans',
): string[] {
  const available = Math.max(20, width - 24)
  const maxLines = Math.max(1, Math.min(3, Math.floor((height - 16) / 19)))
  const measure = (value: string) => [...value].reduce((sum, ch) =>
    sum + 15 * (/\p{Script=Han}/u.test(ch) ? 1 : /\s/.test(ch) ? 0.35 : fontFamily === 'monospace' ? 0.61 : 0.58), 0)
  const wrap = (value: string): string[] => {
    if (!value || measure(value) <= available) return [value]
    const tokens = value.replace(/([\p{Ll}\d])([\p{Lu}])/gu, '$1\u200b$2').split('\u200b')
    const find = (count: number, from: number, result: string[], found: string[][]) => {
      if (count === 1) {
        const last = tokens.slice(from).join('')
        if (last && measure(last) <= available) found.push([...result, last])
        return
      }
      for (let at = from + 1; at < tokens.length; at++) {
        const line = tokens.slice(from, at).join('')
        if (measure(line) > available) break
        find(count - 1, at, [...result, line], found)
      }
    }
    for (let count = 2; count <= maxLines; count++) {
      const candidates: string[][] = []
      find(count, 0, [], candidates)
      if (candidates.length) return candidates.sort((a, b) => {
        const imbalance = (lines: string[]) => Math.max(...lines.map(measure)) - Math.min(...lines.map(measure))
        return imbalance(a) - imbalance(b)
      })[0]
    }
    // Tokens such as long URLs may have no word boundaries. Break at code
    // points, never replace the actual label with an ellipsis.
    const lines: string[] = []
    let current = ''
    for (const ch of value) {
      if (current && measure(current + ch) > available) {
        lines.push(current)
        current = ''
      }
      current += ch
    }
    if (current) lines.push(current)
    return lines
  }
  return title.split('\n').flatMap(wrap)
}
