#!/usr/bin/env node
/**
 * Reload the locally linked Diagram plugin inside a running `dsh web` without
 * restarting the host (the session itself runs inside it).
 *
 * The host reads app.js/app.css once when the plugin is applied, so a rebuilt
 * dist is invisible until the plugin is applied again. dsh-hmr watches the
 * profile manifest, not a linked package's dist, so touching dist does nothing.
 * The proven sequence is: remove, add, then nudge the profile patch file so the
 * watcher recomposes. This script performs exactly that and restores the patch
 * file byte-for-byte afterwards.
 *
 * Usage: node scripts/reload-web-plugin.mjs [--profile=web] [--timeout=30]
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const profile = args.find((arg) => arg.startsWith('--profile='))?.slice('--profile='.length) ?? 'web'
const timeoutSeconds = Number(args.find((arg) => arg.startsWith('--timeout='))?.slice('--timeout='.length)) || 30
const patchFile = path.join(homedir(), '.dsh', 'profiles', profile, 'cordis.patch.yml')
const plugin = '@weimin96/diagram-plugin'
const packageDir = path.join(root, 'package')
const serverMarker = 'diagram-plugin/dist/server.mjs'

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex')

async function serverPids() {
  try {
    const { stdout } = await run('pgrep', ['-f', serverMarker])
    return stdout.split('\n').map((line) => Number(line.trim())).filter(Boolean)
  } catch {
    return []
  }
}

async function startedAt(pid) {
  // `lstart` is locale-dependent ("四 10月/29 ..."), which Date.parse cannot read,
  // and macOS ps has no `etimes`. Force the C locale so the date is English.
  try {
    const { stdout } = await run('ps', ['-o', 'lstart=', '-p', String(pid)], { env: { ...process.env, LC_ALL: 'C', LANG: 'C' } })
    const parsed = Date.parse(stdout.trim())
    return Number.isNaN(parsed) ? 0 : parsed
  } catch {
    return 0
  }
}

const distStamp = (await stat(path.join(packageDir, 'dist', 'server.mjs'))).mtimeMs
const before = await serverPids()

console.log(`profile=${profile} linked=${path.relative(root, packageDir)}`)
console.log(`dist built ${new Date(distStamp).toISOString()} · current server pid(s): ${before.join(', ') || 'none'}`)

// If every running server already started after the build, it is serving this
// bundle and a reload would be busywork (and would drop warm caches).
const starts = await Promise.all(before.map((pid) => startedAt(pid)))
if (before.length && starts.every((started) => started >= distStamp - 2000)) {
  console.log('already current: every server process started after the build; nothing to reload')
  process.exit(0)
}

const backup = await readFile(patchFile)

try {
  await run('dsh', ['plugin', '--profile', profile, 'remove', plugin])
  await run('dsh', ['plugin', '--profile', profile, 'add', `file:${packageDir}`])
  // The watcher coalesces a remove+add that happens too quickly into one state,
  // so wait for the profile manifest to settle before nudging it.
  await new Promise((resolve) => setTimeout(resolve, 1200))
  await writeFile(patchFile, `${backup.toString()}\n# reload ${new Date().toISOString()}\n`)

  const deadline = Date.now() + timeoutSeconds * 1000
  let fresh = []
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const now = await serverPids()
    const added = now.filter((pid) => !before.includes(pid))
    if (added.length) {
      const started = await startedAt(added[0])
      if (started >= distStamp - 2000) { fresh = added; break }
      // A process that predates the build cannot be serving the new bundle.
      fresh = []
    }
  }
  if (!fresh.length) {
    console.error(`Rejected: no server process started after the ${new Date(distStamp).toISOString()} build within ${timeoutSeconds}s.`)
    console.error('The host may not have recomposed; the patch file is being restored unchanged.')
    process.exitCode = 1
  } else {
    console.log(`reloaded: pid ${fresh.join(', ')} started ${new Date(await startedAt(fresh[0])).toISOString()}`)
  }
} finally {
  await writeFile(patchFile, backup)
  const restored = await readFile(patchFile)
  if (sha(restored) !== sha(backup)) {
    console.error('patch file was not restored byte-for-byte; check ~/.dsh/profiles/' + profile + '/cordis.patch.yml')
    process.exitCode = 1
  } else {
    console.log('profile patch restored (sha256 match)')
  }
}
