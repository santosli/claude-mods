// Today's tokens and their API-price cost, counted from Claude Code's own transcripts, so
// every session of the day counts, those from before the plugin loaded included.
// Run by osascript as JavaScript for Automation (macOS); a run reads only what the
// transcripts gained since the last, from the offsets it keeps in its state directory.
// Counting rules follow ccusage and OpenUsage (see the script's header).
export const SCAN_STATE = '~/.token-bar'

// The transcript roots, as ccusage and OpenUsage find them: CLAUDE_CONFIG_DIR's entries
// (comma-separated, each a config directory or its projects directory), or else both
// default homes. The script adds the desktop app's Cowork sessions itself.
export function scanRoots(configDir: string | undefined) {
  const dirs = configDir?.split(',').map(d => d.trim()).filter(Boolean) ?? []
  if (dirs.length === 0) return '~/.config/claude/projects,~/.claude/projects'
  return dirs.map(d => (/\/projects\/?$/.test(d) ? d : `${d.replace(/\/+$/, '')}/projects`)).join(',')
}

export const SCAN_SCRIPT = String.raw`ObjC.import('Foundation')

// Today's tokens and API-price cost, from Claude Code's transcripts.
// argv: transcript roots ('projects' directories, comma-separated, '~' allowed),
//       state directory ('~' allowed), day (YYYY-MM-DD, local).
// Also reads the Claude desktop app's Cowork sessions. Incremental: the state file keeps
// each transcript's read offset and what each reply was counted at, so a run reads only
// what was appended since, and a fuller copy of a reply corrects its count.
// The rules follow ccusage and OpenUsage: one count per reply (message id + request id),
// the fullest copy wins, a sidechain replay of a parent reply is the same reply.

// $ per million tokens: input, output, cache read, fast-mode multiplier. Cache writes
// cost 1.25x input (5 minutes) or 2x (1 hour).
const PRICES = [
  ['claude-fable-5-1', 10, 50, 0.25, 2], ['claude-mythos-5-1', 10, 50, 0.25, 2],
  ['claude-fable-5', 10, 50, 1, 2], ['claude-mythos-5', 10, 50, 1, 2],
  ['claude-opus-5-5', 4, 20, 0.2, 2], ['claude-opus-5', 5, 25, 0.5, 2],
  ['claude-opus-4-8', 5, 25, 0.5, 2], ['claude-opus-4-7', 5, 25, 0.5, 6], ['claude-opus-4-6', 5, 25, 0.5, 6],
  ['claude-sonnet-5-5', 2, 10, 0.2, 2], ['claude-sonnet-5', 2, 10, 0.2, 2], ['claude-sonnet-4-6', 3, 15, 0.3, 2],
  ['claude-haiku-4-5', 1, 5, 0.1, 2],
]

function priceOf(model) {
  // The longest matching id wins ('claude-opus-5-5' before 'claude-opus-5'); a dated or
  // provider-spelled id ('claude-opus-4-8@20260101', 'anthropic.claude-...') still matches.
  const id = model.replace(/^(anthropic\.|us\.anthropic\.|eu\.anthropic\.)/, '').replace(/[@.]/g, '-')
  let best = null
  for (const p of PRICES) if (id === p[0] || id.indexOf(p[0] + '-') === 0) if (!best || p[0].length > best[0].length) best = p
  return best
}

function tokensOf(u) {
  return (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
}

function costOf(model, u) {
  const p = priceOf(model)
  if (!p) return null
  const [, input, output, read, fast] = p
  const cc = u.cache_creation || {}
  const w1h = cc.ephemeral_1h_input_tokens || 0
  const w5m = cc.ephemeral_5m_input_tokens !== undefined ? cc.ephemeral_5m_input_tokens : Math.max((u.cache_creation_input_tokens || 0) - w1h, 0)
  const usd = ((u.input_tokens || 0) * input + (u.output_tokens || 0) * output + (u.cache_read_input_tokens || 0) * read
    + w5m * input * 1.25 + w1h * input * 2) / 1e6
  return u.speed === 'fast' ? usd * fast : usd
}

function dayOf(ms) {
  const d = new Date(ms)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function run(argv) {
  const home = $.NSHomeDirectory().js
  const fm = $.NSFileManager.defaultManager
  const isDir = path => { const flag = Ref(); return fm.fileExistsAtPathIsDirectory(path, flag) && flag[0] }
  const roots = []
  for (const r of argv[0].split(',')) {
    const path = r.trim().replace(/^~/, home).replace(/\/+$/, '')
    if (path && isDir(path) && roots.indexOf(path) === -1) roots.push(path)
  }
  // Cowork sessions keep a Claude Code home of their own, deep under the desktop app's data.
  const cowork = home + '/Library/Application Support/Claude/local-agent-mode-sessions'
  if (isDir(cowork)) {
    const walker = fm.enumeratorAtPath(cowork)
    let rel
    while (!(rel = walker.nextObject).isNil()) {
      if (/(^|\/)\.claude\/projects$/.test(rel.js)) { roots.push(cowork + '/' + rel.js); walker.skipDescendants }
    }
  }
  const stateDir = argv[1].replace(/^~/, home)
  const day = argv[2]
  fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(stateDir, true, $(), $())
  const statePath = stateDir + '/scan-' + day + '.json'

  // counted: key -> [tokens, usd, sidechain, message id]; byMessage: message id -> key
  let state = { version: 2, day: day, files: {}, counted: {}, byMessage: {}, tokens: 0, usd: 0, unpriced: {} }
  const old = $.NSString.stringWithContentsOfFileEncodingError(statePath, $.NSUTF8StringEncoding, $())
  if (!old.isNil()) { try { const s = JSON.parse(old.js); if (s.day === day && s.version === 2) state = s } catch (e) {} }

  // A reply's count, replacing what it was counted at before.
  function count(key, entry) {
    const was = state.counted[key]
    if (was) { state.tokens -= was[0]; state.usd -= was[1] }
    state.counted[key] = entry
    state.tokens += entry[0]
    state.usd += entry[1]
  }

  // Midnight today, local: a transcript last written before then holds nothing of today's.
  const parts = day.split('-').map(Number)
  const startOfDay = new Date(parts[0], parts[1] - 1, parts[2]).getTime()

  for (const root of roots) {
    const walker = fm.enumeratorAtPath(root)
    let rel
    while (!(rel = walker.nextObject).isNil()) {
      if (!rel.js.endsWith('.jsonl')) continue
      const path = root + '/' + rel.js
      const attrs = fm.attributesOfItemAtPathError(path, $())
      if (attrs.isNil()) continue
      if (attrs.objectForKey($.NSFileModificationDate).timeIntervalSince1970 * 1000 < startOfDay) continue
      const size = Number(attrs.objectForKey($.NSFileSize).longLongValue)
      let offset = state.files[path] || 0
      if (size < offset) offset = 0 // rewritten: read again; replies already counted stay counted once
      if (size === offset) continue

      const fh = $.NSFileHandle.fileHandleForReadingAtPath(path)
      if (fh.isNil()) continue
      fh.seekToFileOffset(offset)
      const data = fh.readDataToEndOfFile
      fh.closeFile
      const text = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js || ''
      // Whole lines only; a line still being written waits for the next run.
      const end = text.lastIndexOf('\n') + 1
      const rest = text.slice(end)
      state.files[path] = offset + Number(data.length) - (rest ? $(rest).lengthOfBytesUsingEncoding($.NSUTF8StringEncoding) : 0)

      for (const line of text.slice(0, end).split('\n')) {
        if (line.indexOf('"usage"') === -1 || line.indexOf('"assistant"') === -1) continue
        let d
        try { d = JSON.parse(line) } catch (e) { continue }
        const m = d.message
        if (d.type !== 'assistant' || !m || !m.usage || !d.timestamp) continue
        if (dayOf(Date.parse(d.timestamp)) !== day) continue
        const u = m.usage
        const model = m.model || ''
        const tokens = tokensOf(u)
        const usd = model === '<synthetic>' ? 0 : costOf(model, u)
        if (usd === null) state.unpriced[model] = (state.unpriced[model] || 0) + 1
        const sidechain = !!d.isSidechain
        const entry = [tokens, usd || 0, sidechain, m.id || '']

        // A reply is its message id and request id; without a request id, its session and time.
        const key = !m.id ? 'line:' + (d.uuid || d.sessionId + ':' + d.timestamp)
          : d.requestId ? m.id + ':' + d.requestId : m.id + ':' + d.sessionId + ':' + d.timestamp
        // A sidechain replaying a parent reply under a new request id is that reply.
        let same = state.counted[key] ? key : null
        if (!same && m.id && state.byMessage[m.id]) {
          const other = state.counted[state.byMessage[m.id]]
          if (other && (other[2] || sidechain)) same = state.byMessage[m.id]
        }
        if (!same) {
          count(key, entry)
          if (m.id && !state.byMessage[m.id]) state.byMessage[m.id] = key
          continue
        }
        // Keep the better copy: the parent over a replay, then the fullest.
        const was = state.counted[same]
        const better = was[2] && !sidechain ? true : !was[2] && sidechain ? false : tokens > was[0]
        if (better) {
          if (same !== key) { state.tokens -= was[0]; state.usd -= was[1]; delete state.counted[same] }
          count(key, entry)
          if (m.id) state.byMessage[m.id] = key
        }
      }
    }
  }

  const tmp = statePath + '.' + $.NSProcessInfo.processInfo.processIdentifier + '.tmp'
  $(JSON.stringify(state)).writeToFileAtomicallyEncodingError(tmp, true, $.NSUTF8StringEncoding, $())
  fm.removeItemAtPathError(statePath, $())
  fm.moveItemAtPathToPathError(tmp, statePath, $())
  const names = fm.contentsOfDirectoryAtPathError(stateDir, $())
  if (!names.isNil()) for (let i = 0; i < names.count; i++) {
    const n = names.objectAtIndex(i).js
    if (/^scan-\d{4}-\d{2}-\d{2}\.json$/.test(n) && n !== 'scan-' + day + '.json') fm.removeItemAtPathError(stateDir + '/' + n, $())
  }
  return JSON.stringify({ day: day, tokens: state.tokens, usd: Math.round(state.usd * 1e4) / 1e4, unpriced: state.unpriced, roots: roots.length })
}
`
