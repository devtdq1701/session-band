import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { AgentCard, Beat, Command, Limit, LogLine, Peer, SessionRow, Snapshot, Waiting } from '../types'
import { branchChip, changedMark, pillOf, totalsMark, where } from './band-svg'
import type { Piece, Pill } from './band-svg'
import { drawDeck, PALETTES } from './deck-svg'

// Shape tags decline what an earlier version stored, which outlives a reload.
const snapshot = atom({ plugin: 'session-band', key: 'snap' } as const, null, { shape: 'snap-3' })
const lastTurn = atom({ plugin: 'session-band', key: 'lastTurn' } as const, null, { shape: 'turn-3' })
const isWorking = atom({ plugin: 'session-band', key: 'isWorking' } as const, false)
const warned = atom({ plugin: 'session-band', key: 'warned' } as const, [])
const label = atom({ plugin: 'session-band', key: 'label' } as const, null)
const peers = atom({ plugin: 'session-band', key: 'peers' } as const, [], { shape: 'peers-4' })
// Alerts pressed from this band, hidden until the peer moves on or the press is not picked up.
const hiddenAlerts = atom({ plugin: 'session-band', key: 'hiddenAlerts' } as const, [])
const pending = atom({ plugin: 'session-band', key: 'pending' } as const, [])
const sessions = atom({ plugin: 'session-band', key: 'sessions' } as const, [])
const agents = atom({ plugin: 'session-band', key: 'agents' } as const, [])
const log = atom({ plugin: 'session-band', key: 'log' } as const, [])
const turnCostStart = atom({ plugin: 'session-band', key: 'turnCostStart' } as const, null)
const saveBrainSentAt = atom({ plugin: 'session-band', key: 'saveBrainSentAt' } as const, null)

const PANE = 'session-deck'
const SAVE_BRAIN_COOLDOWN_MS = 60_000
const TICK_MS = 15_000
// Another session's press lands within one poll; a command still unread after INBOX_STALE_MS failed.
const INBOX_POLL_MS = 2000
const INBOX_STALE_MS = 3 * INBOX_POLL_MS + 1000
// A command older than this (its sender gone before cleaning up) is dropped, not run.
const INBOX_MAX_AGE_MS = 30_000
// Inbox protocol version written to the heartbeat: a peer without it gets no buttons.
const CONTROLS = 1
const NAME_MAX = 28
const PERSON_TOOLS = ['AskUserQuestion', 'ExitPlanMode']
const PEER_ALIVE_MS = 3 * 60_000
const LIMIT_WARN_AT = [95, 80] as const
const CONTEXT_WARN_AT = [85, 70] as const
// A pane's columns are cells of the surface's code font: about 7.6 CSS px on the desktop app.
const CELL_PX = 7.6
const LANE_ROWS = 8
const LOG_ROWS = 12
const SHORT: Record<string, string> = { five_hour: '5h', seven_day: '7d' }
const SAVE_BRAIN_PROMPT = 'save-brain: save the session state now (save-state).'
const ACCEPT_ANSWER =
  'The user pressed Accept for this question from another session (session-band): go with your ' +
  'recommended option for every question and carry on.'
const DECLINE_ANSWER = {
  AskUserQuestion:
    'The user pressed Decline for this question from another session (session-band): take none of the ' +
    'options, end your turn and wait for their next message.',
  ExitPlanMode:
    'The user declined this plan from another session (session-band): stay in plan mode, end your turn ' +
    'and wait for their feedback.',
}
const ASK_DENY =
  'Goal mode is on (unattended.on): the user is away, do not ask. Pick the recommended option, ' +
  'mark it as decided on their behalf for them to review, and carry on.'
// Translucent tints read on light and dark themes alike.
const TINT = { error: 'rgba(226,75,74,0.14)', warning: 'rgba(239,159,39,0.16)', tile: 'rgba(128,128,128,0.10)' }
const LANE_COLOR: Record<AgentCard['status'], string> = {
  running: '#378ADD',
  done: '#1D9E75',
  stopped: '#888780',
  failed: '#E24B4A',
}

type Tone = 'error' | 'warning' | undefined

const tone = (percent: number | null, at: readonly [number, number]): Tone =>
  percent === null ? undefined : percent >= at[0] ? 'error' : percent >= at[1] ? 'warning' : undefined

const tokens = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

const span = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
  return `${Math.floor(minutes / 1440)}d${Math.floor((minutes % 1440) / 60)}h`
}

const seconds = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : span(ms))

const clock = (at: number) => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const oneLine = (text: string, max: number) => {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

const summarize = (input: unknown) => {
  const i = (input ?? {}) as Record<string, unknown>
  const first = Array.isArray(i.questions) ? (i.questions[0] as { question?: unknown } | undefined) : undefined
  const raw =
    typeof i.command === 'string'
      ? i.command
      : typeof i.file_path === 'string'
        ? i.file_path
        : typeof first?.question === 'string'
          ? first.question
          : ''
  return oneLine(raw, 70)
}

const inputTokens = (u: ModelUsage) => u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens

const cacheHit = (u: ModelUsage) => {
  const input = inputTokens(u)
  return input === 0 ? null : Math.round((u.cache_read_input_tokens / input) * 100)
}

const git = async ($: EngineInterface, cwd: string, args: string[]) => {
  try {
    const ran = await $.process.run(['git', ...args], { cwd, timeoutMs: 5000 })
    return ran.exitCode === 0 ? ran.stdout.trim() : null
  } catch {
    return null
  }
}

const home = async ($: EngineInterface) => (await $.env.get('HOME')) ?? ''
const beatsDir = async ($: EngineInterface) => `${await home($)}/.claude/session-band/sessions`
const inboxDir = async ($: EngineInterface, id: string) => `${await home($)}/.claude/session-band/inbox/${id}`

// An accept or decline from another session's band settles the matching wait in this one.
const remoteAnswers = new Map<string, (verb: 'accept' | 'decline') => void>()

// Same path the security gate checks: CLAUDE_UNATTENDED_FLAG, else ~/.claude/hooks/unattended.on.
const flagPath = async ($: EngineInterface) =>
  (await $.env.get('CLAUDE_UNATTENDED_FLAG')) || `${await home($)}/.claude/hooks/unattended.on`

// The flag file is the truth: it is global to every session and can change by hand.
const isGoalModeOn = async ($: EngineInterface) => $.fs.exists(await flagPath($))

const markWarned = async ($: EngineInterface, key: string) => {
  if ((await read($, warned)).includes(key)) return false
  await update($, warned, seen => [...seen, key].slice(-100))
  return true
}

const say = async ($: EngineInterface, text: string, lineTone: LogLine['tone'] = null) => {
  const at = await $.clock.now()
  await update($, log, lines => [...lines, { at, text, tone: lineTone }].slice(-40))
}

const hueOf = (t: Tone): 'red' | 'amber' | null => (t === 'error' ? 'red' : t === 'warning' ? 'amber' : null)

// One save-brain prompt per minute: a second press inside it only says how long to wait.
const saveBrain = async ($: EngineInterface) => {
  const [now, sentAt] = await Promise.all([$.clock.now(), read($, saveBrainSentAt)])
  if (sentAt !== null && now - sentAt < SAVE_BRAIN_COOLDOWN_MS) {
    const wait = Math.ceil((SAVE_BRAIN_COOLDOWN_MS - (now - sentAt)) / 1000)
    $.ui.toast(`save-brain was sent ${Math.round((now - sentAt) / 1000)}s ago; wait ${wait}s`, { timeoutMs: 5000 })
    return
  }
  await update($, saveBrainSentAt, () => now)
  await say($, 'save-brain sent')
  $.prompt.submit({ text: SAVE_BRAIN_PROMPT }).catch(err => {
    $.ui.toast(`save-brain failed: ${oneLine(String(err), 120)}`, { timeoutMs: 10_000 })
  })
}

// $.session.compact() is refused in the desktop app's SDK sessions; /compact runs there.
const compactNow = async ($: EngineInterface) => {
  try {
    const { text } = await $.command.run({ command: 'compact' })
    await say($, 'compact run')
    if (text) $.ui.toast(oneLine(text, 80), { timeoutMs: 5000 })
  } catch (err) {
    await say($, 'compact failed', 'error')
    $.ui.toast(`Compact failed: ${oneLine(String(err), 120)}`, { timeoutMs: 10_000 })
  }
}

const VERB_TEXT: Record<Command['verb'], string> = {
  compact: 'Compact',
  'save-brain': 'Save-brain',
  accept: 'Accept',
  decline: 'Decline',
}

// One key per alert: a new question or a new idle period is a new alert.
const alertKey = (p: Peer) => (p.waiting !== null ? `${p.id}@wait@${p.waiting.id}` : `${p.id}@cold@${p.lastTurnAt}`)

// Writes a command into the peer's inbox; the peer runs it within one poll.
const sendCommand = async ($: EngineInterface, peer: Peer, verb: Command['verb']) => {
  const key = alertKey(peer)
  await update($, hiddenAlerts, keys => [...keys.filter(k => k !== key), key].slice(-50))
  const [dir, from, at] = await Promise.all([inboxDir($, peer.id), $.session.id(), $.clock.now()])
  const command: Command = { id: `${at}-${verb}`, verb, waitId: peer.waiting?.id ?? null, from, at }
  const path = `${dir}/${command.id}.json`
  const name = oneLine(peer.label, NAME_MAX)
  try {
    await $.process.run(['mkdir', '-p', dir], { timeoutMs: 5000 })
    await $.fs.write(path, JSON.stringify(command))
  } catch (err) {
    await update($, hiddenAlerts, keys => keys.filter(k => k !== key))
    $.ui.toast(`${VERB_TEXT[verb]} → ${name} failed: ${oneLine(String(err), 80)}`, { timeoutMs: 8000 })
    return
  }
  await say($, `${VERB_TEXT[verb]} → ${name}`)
  $.ui.toast(`${VERB_TEXT[verb]} → ${name}`, { timeoutMs: 3000 })
  // Checked off the press: a hook's own $.clock waits count against its budget.
  $.clock.after(INBOX_STALE_MS, async () => {
    if (!(await $.fs.exists(path))) return
    await $.process.run(['rm', '-f', '--', path], { timeoutMs: 5000 }).catch(() => undefined)
    await update($, hiddenAlerts, keys => keys.filter(k => k !== key))
    await say($, `${VERB_TEXT[verb]} → ${name}: not picked up`, 'error')
    $.ui.toast(`${name} did not pick up ${VERB_TEXT[verb]}`, { timeoutMs: 8000 })
  })
}

// Runs what other sessions' bands pressed for this one. Each file is removed before it runs.
const pollInbox = async ($: EngineInterface) => {
  const dir = await inboxDir($, await $.session.id())
  for (const entry of await $.fs.list(dir).catch(() => [])) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    const path = `${dir}/${entry.name}`
    let command: Command
    try {
      command = JSON.parse(await $.fs.read(path)) as Command
    } catch {
      continue
    }
    const removed = await $.process.run(['rm', '--', path], { timeoutMs: 5000 }).catch(() => null)
    if (removed === null || removed.exitCode !== 0) continue
    if ((await $.clock.now()) - command.at > INBOX_MAX_AGE_MS) {
      await say($, `${VERB_TEXT[command.verb] ?? command.verb} from another session: too old, dropped`, 'warning')
      continue
    }
    if (command.verb === 'compact') {
      await say($, 'compact pressed in another session')
      await compactNow($)
    } else if (command.verb === 'save-brain') {
      await saveBrain($)
    } else {
      const settle = command.waitId === null ? undefined : remoteAnswers.get(command.waitId)
      if (settle === undefined) {
        await say($, `${VERB_TEXT[command.verb]} from another session: nothing waiting`, 'warning')
        continue
      }
      settle(command.verb)
    }
  }
}

// Holds a question or a plan for the person, here or from another session's band, whichever
// answers first. Returning while next(e) is pending aborts the dialog beneath.
const waitForPerson = async <R,>(
  $: EngineInterface,
  id: string,
  local: Promise<R>,
  answer: (verb: 'accept' | 'decline') => R | null,
): Promise<R> => {
  local.catch(() => undefined)
  const remote = new Promise<'accept' | 'decline'>(resolve => remoteAnswers.set(id, resolve))
  try {
    const won = await Promise.race([local.then(r => ({ r })), remote.then(verb => ({ verb }))])
    if ('r' in won) return won.r
    const answered = answer(won.verb)
    if (answered === null) return await local // a verb this tool takes no answer for
    await say($, `${VERB_TEXT[won.verb]} from another session`, 'success')
    return answered
  } finally {
    remoteAnswers.delete(id)
  }
}

const openDeck = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Session deck' })

const refresh = async ($: EngineInterface) => {
  const [usage, cwd, now, prompts, isGoalMode] = await Promise.all([
    $.session.usage(),
    $.session.cwd(),
    $.clock.now(),
    $.session.turns(),
    isGoalModeOn($),
  ])
  const [status, dirs] = await Promise.all([
    git($, cwd, ['status', '--porcelain=v2', '--branch']),
    git($, cwd, ['rev-parse', '--git-dir', '--git-common-dir']),
  ])
  const lines = status?.split('\n') ?? []
  const head = lines.find(l => l.startsWith('# branch.head '))?.slice(14)
  const ab = lines.find(l => l.startsWith('# branch.ab '))?.match(/\+(\d+) -(\d+)/)
  const [gitDir, commonDir] = dirs?.split('\n') ?? []
  const limits: Limit[] = usage.rateLimits.map(r => ({
    kind: r.kind,
    percent: r.percentUsed,
    resetsAt: r.resetsAt ?? null,
  }))
  const snap: Snapshot = {
    at: now,
    startedAt: usage.startedAt,
    prompts,
    dir: cwd.split('/').pop() || cwd,
    branch: head && head !== '(detached)' ? head : null,
    isWorktree: gitDir !== commonDir,
    ahead: Number(ab?.[1] ?? 0),
    behind: Number(ab?.[2] ?? 0),
    changed: lines.filter(l => l && !l.startsWith('#')).length,
    contextPercent: usage.context.percent ?? null,
    contextTokens: usage.context.tokens ?? null,
    contextWindow: usage.context.window,
    costUsd: usage.cost?.usd ?? null,
    limits,
    isGoalMode,
  }
  await update($, snapshot, () => snap)

  for (const limit of limits) {
    const threshold = LIMIT_WARN_AT.find(t => limit.percent >= t)
    if (threshold === undefined) continue
    if (await markWarned($, `${limit.kind}@${threshold}@${limit.resetsAt}`)) {
      const resets = limit.resetsAt ? `, resets in ${span(Date.parse(limit.resetsAt) - now)}` : ''
      $.ui.toast(`${SHORT[limit.kind] ?? limit.kind} limit at ${limit.percent}%${resets}`, { timeoutMs: 10_000 })
    }
  }

  const contextThreshold = CONTEXT_WARN_AT.find(t => (snap.contextPercent ?? 0) >= t)
  if (contextThreshold !== undefined && (await markWarned($, `context@${contextThreshold}@${snap.startedAt}`))) {
    $.ui.toast(`Context at ${snap.contextPercent}%: save a handoff, then /compact`, { timeoutMs: 15_000 })
  }
}

const rowOf = (b: Beat, isSelf: boolean, now: number): SessionRow => {
  const waiting = b.waiting ?? null
  const base = { id: b.id, label: b.label, dir: b.dir, isSelf, coldInMs: null }
  if (waiting !== null) return { ...base, state: 'waiting', sinceMs: now - waiting.since }
  if (b.isWorking) return { ...base, state: 'working', sinceMs: 0 }
  if (b.lastTurnAt === null) return { ...base, state: 'new', sinceMs: 0 }
  const coldInMs = b.lastTurnAt + b.ttlMs - now
  return { ...base, state: coldInMs <= 0 ? 'cold' : 'idle', sinceMs: now - b.lastTurnAt, coldInMs }
}

// Writes this session's heartbeat and reads every other live session's, so each session can
// remind about the others' prompt caches and questions.
const syncPeers = async ($: EngineInterface, ttlMs: number, leadMs: number) => {
  const [dir, id, cwd, now, turn, working, name, waits] = await Promise.all([
    beatsDir($),
    $.session.id(),
    $.session.cwd(),
    $.clock.now(),
    read($, lastTurn),
    read($, isWorking),
    read($, label),
    read($, pending),
  ])
  const folder = cwd.split('/').pop() || cwd
  const beat: Beat = {
    id,
    label: name ?? folder,
    dir: folder,
    at: now,
    lastTurnAt: turn?.at ?? null,
    isWorking: working,
    ttlMs,
    waiting: waits[0] ?? null,
    controls: CONTROLS,
  }
  try {
    await $.fs.write(`${dir}/${id}.json`, JSON.stringify(beat))
  } catch {
    return
  }

  const found: Peer[] = []
  const rows: SessionRow[] = [rowOf(beat, true, now)]
  for (const entry of await $.fs.list(dir).catch(() => [])) {
    if (entry.kind !== 'file' || entry.name === `${id}.json` || !entry.name.endsWith('.json')) continue
    let other: Beat
    try {
      other = JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as Beat
    } catch {
      continue
    }
    if (now - other.at > PEER_ALIVE_MS) continue
    const row = rowOf(other, false, now)
    rows.push(row)
    const waiting = other.waiting ?? null
    const hasControls = (other.controls ?? 0) >= CONTROLS
    const name = oneLine(other.label, NAME_MAX)
    if (waiting !== null) {
      found.push({ id: other.id, label: other.label, dir: other.dir, lastTurnAt: other.lastTurnAt, coldInMs: null, waiting, hasControls })
      if (await markWarned($, `wait@${other.id}@${waiting.id}`)) {
        $.ui.toast(`🔔 ${name}`, { timeoutMs: 60_000 })
      }
      continue
    }
    if (row.state !== 'idle' || row.coldInMs === null || row.coldInMs > leadMs) continue
    found.push({
      id: other.id,
      label: other.label,
      dir: other.dir,
      lastTurnAt: other.lastTurnAt,
      coldInMs: row.coldInMs,
      waiting: null,
      hasControls,
    })
    if (await markWarned($, `peer@${other.id}@${other.lastTurnAt}`)) {
      $.ui.toast(`⏳ ${name}`, { timeoutMs: 30_000 })
    }
  }
  await update($, peers, () => found)
  await update($, sessions, () => rows)
}

const addPending = async ($: EngineInterface, id: string, tool: string, input: unknown, ttlMs: number, leadMs: number) => {
  const since = await $.clock.now()
  await update($, pending, list => [...list.filter(w => w.id !== id), { id, tool, summary: summarize(input), since }])
  await say($, `waiting for you: ${tool}`, 'warning')
  await syncPeers($, ttlMs, leadMs)
}

const clearPending = async ($: EngineInterface, id: string | null, ttlMs: number, leadMs: number) => {
  const list = await read($, pending)
  if (list.length === 0 || (id !== null && !list.some(w => w.id === id))) return
  await update($, pending, l => (id === null ? [] : l.filter(w => w.id !== id)))
  await syncPeers($, ttlMs, leadMs)
}

// One reminder per idle period, only between main turns, in the window before the cache goes cold.
const remindCache = async ($: EngineInterface, ttlMs: number, leadMs: number) => {
  const [turn, working, now] = await Promise.all([read($, lastTurn), read($, isWorking), $.clock.now()])
  if (turn === null || working) return
  const idleMs = now - turn.at
  if (idleMs < ttlMs - leadMs || idleMs >= ttlMs) return
  if (await markWarned($, `cache@${turn.at}`)) {
    $.ui.toast(`Prompt cache goes cold in ~${span(ttlMs - idleMs)}: send a prompt, /compact or save a handoff`, {
      timeoutMs: 30_000,
    })
  }
}

const setGoalMode = async ($: EngineInterface, isOn: boolean) => {
  const path = await flagPath($)
  if (isOn) {
    await $.fs.write(path, `on since ${new Date(await $.clock.now()).toISOString()} (session-band)\n`)
  } else {
    await $.process.run(['rm', '-f', '--', path], { timeoutMs: 5000 })
  }
  await refresh($)
  await say($, isOn ? 'goal mode on' : 'goal mode off', isOn ? 'warning' : null)
  $.ui.toast(
    isOn
      ? 'Goal mode ON for every session: approval asks are denied, AskUserQuestion is blocked'
      : 'Goal mode OFF: approval asks are back to normal',
    { timeoutMs: 8000 },
  )
}

const tick = async ($: EngineInterface, ttlMs: number, leadMs: number) => {
  await refresh($)
  await remindCache($, ttlMs, leadMs)
  await syncPeers($, ttlMs, leadMs)
}

export const register: Register = (on, options) => {
  const ttlMs = options.cache_ttl === '5m' ? 5 * 60_000 : 60 * 60_000
  const leadMs = options.cache_ttl === '5m' ? 60_000 : 10 * 60_000

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'goal-mode',
      description: 'Toggle goal mode (unattended auto-deny): /goal-mode on | off | status',
    })
    await $.command.register({ name: 'deck', description: 'Open the Session deck pane: agents, sessions, log' })
    const dir = await beatsDir($)
    await $.process.run(['mkdir', '-p', dir], { timeoutMs: 5000 }).catch(() => undefined)
    // Heartbeats of sessions gone for a day are dropped.
    await $.process
      .run(['find', dir, '-name', '*.json', '-mmin', '+1440', '-delete'], { timeoutMs: 5000 })
      .catch(() => undefined)
    await $.process.run(['mkdir', '-p', await inboxDir($, await $.session.id())], { timeoutMs: 5000 }).catch(() => undefined)
    await tick($, ttlMs, leadMs)
    $.clock.every(TICK_MS, () => void tick($, ttlMs, leadMs))
    $.clock.every(INBOX_POLL_MS, () => void pollInbox($))

    return started
  })

  on('session.attach', { surface: 'desktop' }, async ($, e, next) => {
    const attached = await next(e)
    await refresh($)

    return attached
  })

  on('command.run', { command: 'goal-mode' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await setGoalMode($, arg === 'on')
    }

    return { text: `Goal mode: ${(await isGoalModeOn($)) ? 'ON (auto-deny)' : 'OFF'} · flag ${await flagPath($)}` }
  })

  on('command.run', { command: 'deck' }, async $ => {
    await openDeck($)

    return { text: 'Session deck opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, isWorking, () => true)
    if (e.origin.kind === 'composer') {
      const text = oneLine(e.text, 40)
      if (text && (await read($, label)) === null) await update($, label, () => text)
      if (text) await say($, `› ${oneLine(e.text, 60)}`)
    }
    const { cost } = await $.session.usage()
    await update($, turnCostStart, () => cost?.usd ?? null)

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined || !started.agentId) return started
    const card: AgentCard = {
      id: started.agentId,
      type: e.subagentType.split(':').pop() || e.subagentType,
      description: oneLine(e.description, 60),
      spawnedAt: await $.clock.now(),
      endedAt: null,
      status: 'running',
      steps: 0,
      ctxTokens: 0,
      outTokens: 0,
    }
    await update($, agents, list => [...list.filter(c => c.id !== card.id), card].slice(-30))
    await say($, `+ ${card.type} · ${card.description}`)

    return started
  })

  // A subagent's request: one step on its card, its context and output tokens.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const id = e.agentId
    const u = result.usage
    if (id && u) {
      await update($, agents, list =>
        list.map(c =>
          c.id === id
            ? { ...c, status: 'running', endedAt: null, steps: c.steps + 1, ctxTokens: inputTokens(u), outTokens: c.outTokens + u.output_tokens }
            : c,
        ),
      )
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    const at = await $.clock.now()
    if (e.agentId) {
      const id = e.agentId
      const status: AgentCard['status'] = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
      const card = (await read($, agents)).find(c => c.id === id)
      if (card) {
        await update($, agents, list => list.map(c => (c.id === id ? { ...c, status, endedAt: at } : c)))
        await say($, `${status === 'done' ? '✓' : '✗'} ${card.type} · ${seconds(e.durationMs)}`, status === 'done' ? 'success' : 'error')
      }
    } else {
      const [usage, startCost] = await Promise.all([$.session.usage(), read($, turnCostStart)])
      const costNow = usage.cost?.usd ?? null
      await update($, isWorking, () => false)
      await clearPending($, null, ttlMs, leadMs)
      await update($, lastTurn, () => ({
        at,
        durationMs: e.durationMs,
        model: e.usage?.model ?? null,
        cacheHit: e.usage ? cacheHit(e.usage) : null,
        costUsd: costNow !== null && startCost !== null ? costNow - startCost : null,
      }))
      await say($, `turn done · ${seconds(e.durationMs)}`)
    }
    await refresh($)
    await syncPeers($, ttlMs, leadMs)

    return completed
  })

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    await refresh($)

    return measured
  })

  // A question or a plan waits on the person until the call settles. Matched by tool name only:
  // a hook that may match a tool turns off its move to the background.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (await isGoalModeOn($)) return { deny: ASK_DENY }
    await addPending($, e.tool_use_id, e.tool, e, ttlMs, leadMs)
    try {
      return await waitForPerson($, e.tool_use_id, next(e), verb => ({
        deny: verb === 'accept' ? ACCEPT_ANSWER : DECLINE_ANSWER.AskUserQuestion,
      }))
    } finally {
      await clearPending($, e.tool_use_id, ttlMs, leadMs)
    }
  })

  // A plan's approval also leaves plan mode, which a hook's answer cannot do: decline only.
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    await addPending($, e.tool_use_id, e.tool, e, ttlMs, leadMs)
    try {
      return await waitForPerson($, e.tool_use_id, next(e), verb =>
        verb === 'decline' ? { deny: DECLINE_ANSWER.ExitPlanMode } : null,
      )
    } finally {
      await clearPending($, e.tool_use_id, ttlMs, leadMs)
    }
  })

  // ---------------------------------------------------------------- band

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e)
    const snap = await read($, snapshot)
    if (snap === null) return next(e)

    const { Box, Button, Svg, Text } = $.ui.resolve(e)
    const [turn, allPeers, hidden, cards, now] = await Promise.all([
      read($, lastTurn),
      read($, peers),
      read($, hiddenAlerts),
      read($, agents),
      $.clock.now(),
    ])
    const others = allPeers.filter(p => !hidden.includes(alertKey(p)))

    const totals = `${span(snap.at - snap.startedAt)}${snap.costUsd === null ? '' : ` · $${snap.costUsd.toFixed(2)}`}`

    let cacheText: string | null = null
    let cacheTone: Tone
    let ownNote: string | null = null
    if (turn !== null && turn.at >= snap.startedAt && !e.props.isWorking) {
      const idleMs = Math.max(0, now - turn.at)
      const hit = turn.cacheHit === null ? 'cache' : `cache ${turn.cacheHit}%`
      if (idleMs >= ttlMs) {
        cacheText = `${hit} · cold`
        cacheTone = 'error'
        ownNote = 'This session\'s cache is cold'
      } else if (idleMs >= ttlMs - leadMs) {
        cacheText = `${hit} · cold in ${span(ttlMs - idleMs)}`
        cacheTone = 'warning'
        ownNote = `This session\'s cache goes cold in ${span(ttlMs - idleMs)}`
      } else {
        cacheText = `${hit} · idle ${span(idleMs)}`
      }
    } else if (turn?.cacheHit != null) {
      cacheText = `cache ${turn.cacheHit}%`
    }
    if (ownNote === null && !e.props.isWorking && (snap.contextPercent ?? 0) >= CONTEXT_WARN_AT[1]) {
      ownNote = `Context ${snap.contextPercent}%`
    }
    const running = cards.filter(c => c.status === 'running').length

    // One row per peer that needs the person: its name, and the presses that act in that session.
    const alert = (p: Peer) => {
      const isWaiting = p.waiting !== null
      const verbs: Command['verb'][] = !p.hasControls
        ? []
        : isWaiting
          ? p.waiting?.tool === 'ExitPlanMode'
            ? ['decline']
            : ['accept', 'decline']
          : ['save-brain', 'compact']
      return (
        <Box
          key={`peer-${p.id}`}
          flexDirection="row"
          alignItems="center"
          width="100%"
          backgroundColor={isWaiting ? TINT.error : TINT.warning}
          paddingX={1}
          columnGap={1}
        >
          {/* minWidth 0: a flex child is otherwise as wide as its text, so the cut never happens. */}
          <Box flexShrink={1} flexGrow={1} minWidth={0}>
            <Text color={isWaiting ? 'error' : 'warning'} wrap="truncate-end">
              {`${isWaiting ? '🔔' : '⏳'} ${oneLine(p.label, NAME_MAX)}`}
            </Text>
          </Box>
          {verbs.map(verb => (
            <Button
              key={`${verb}-${p.id}`}
              label={VERB_TEXT[verb]}
              variant={verb === 'accept' ? 'primary' : undefined}
              dimColor={verb !== 'accept'}
              onPress={() => sendCommand($, p, verb)}
            />
          ))}
        </Box>
      )
    }

    // One number per pill; colour only when something needs the person. Secondary figures
    // (tokens, reset time) show only while their pill warns; the Deck keeps the full numbers.
    const pills: Pill[] = [
      {
        label: 'ctx',
        icon: 'gauge',
        value: snap.contextPercent === null ? '…' : `${snap.contextPercent}%`,
        detail: '',
        accent: hueOf(tone(snap.contextPercent, CONTEXT_WARN_AT)) ?? 'blue',
        meter: snap.contextPercent ?? undefined,
      },
      ...snap.limits.map(l => {
        const accent = hueOf(tone(l.percent, LIMIT_WARN_AT))
        return {
          label: SHORT[l.kind] ?? l.kind,
          icon: 'clock' as const,
          value: `${l.percent}%`,
          detail: accent !== null && l.resetsAt ? `↻${span(Date.parse(l.resetsAt) - now)}` : '',
          accent,
        }
      }),
    ]
    if (cacheText !== null) {
      const hit = turn?.cacheHit ?? null
      const accent = hueOf(cacheTone)
      pills.push({
        label: 'cache',
        icon: 'database',
        value: accent !== null ? cacheText.replace(/^cache( \d+%)?( · )?/, '') : hit === null ? '' : `${hit}%`,
        detail: '',
        accent,
      })
    }
    if (running > 0) pills.push({ label: 'agent', icon: 'agents', value: `${running}`, detail: 'running', accent: 'blue' })

    const palette = PALETTES[options.theme === 'dark' ? 'dark' : 'light']
    const draw = (key: string, piece: Piece, alt: string) => (
      <Box key={key} flexShrink={0}>
        <Svg source={piece.svg} alt={alt} width={piece.width} height={piece.height} />
      </Box>
    )
    const branch =
      snap.branch === null
        ? ''
        : `${snap.branch}${snap.isWorktree ? ' · worktree' : ''}${snap.ahead ? ` ↑${snap.ahead}` : ''}${snap.behind ? ` ↓${snap.behind}` : ''}`
    const saveBrainAt = await read($, saveBrainSentAt)
    const isCooling = saveBrainAt !== null && now - saveBrainAt < SAVE_BRAIN_COOLDOWN_MS

    // Row 1: where (left); totals and the buttons together on the right. Row 2: pills, wrapping.
    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" width="100%">
          <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={1} flexWrap="wrap">
            {draw('where', where(snap.dir, snap.isGoalMode, palette), snap.dir)}
            {branch !== '' && draw('branch', branchChip(branch, palette), branch)}
            {snap.changed > 0 && draw('changed', changedMark(snap.changed, palette), `${snap.changed} changed`)}
          </Box>
          <Box flexDirection="row" alignItems="center" flexShrink={0} columnGap={1} marginLeft={2}>
            {draw('totals', totalsMark(totals, palette), totals)}
            <Button key="save-brain" label="Save" dimColor onPress={() => void saveBrain($)} />
            <Button key="deck" label="Deck" dimColor onPress={() => void openDeck($)} />
            <Button
              key="goal-mode"
              label={snap.isGoalMode ? 'Goal off' : 'Goal'}
              variant={snap.isGoalMode ? 'primary' : undefined}
              dimColor={!snap.isGoalMode}
              onPress={() => setGoalMode($, !snap.isGoalMode)}
            />
          </Box>
        </Box>
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" width="100%">
          <Box flexDirection="row" alignItems="center" columnGap={1} rowGap={1} flexWrap="wrap" flexShrink={1} minWidth={0}>
            {pills.map(pill => draw(`pill-${pill.label}`, pillOf(pill, palette), `${pill.label} ${pill.value} ${pill.detail}`))}
          </Box>
          {/* The cache or context warning lives on its pill; its action sits at the row's end. */}
          {ownNote !== null && (
            <Box flexShrink={0} marginLeft={2}>
              <Button key="compact" label="Compact" onPress={() => compactNow($)} />
            </Box>
          )}
        </Box>
        {others.map(alert)}
      </Box>
    )
  })

  // ---------------------------------------------------------------- deck

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    // Surfaces without Svg (a terminal) get a text lane instead.
    const Svg = 'Svg' in els ? els.Svg : null
    const [snap, turn, cards, rows, lines, now] = await Promise.all([
      read($, snapshot),
      read($, lastTurn),
      read($, agents),
      read($, sessions),
      read($, log),
      $.clock.now(),
    ])

    const columns = e.props.bodyColumns
    const heading = (text: string, note = '') => (
      <Box flexDirection="row" marginTop={1} marginBottom={0} columnGap={1}>
        <Text size="footnote" weight="semibold">{text}</Text>
        {note !== '' && <Text size="footnote" dimColor>{note}</Text>}
      </Box>
    )
    const tile = (name: string, value: string, valueTone?: Tone) => (
      <Box flexDirection="column" flexGrow={1} borderStyle="round" borderDimColor paddingX={1}>
        <Text size="caption" dimColor>{name}</Text>
        <Text weight="semibold" color={valueTone}>{value}</Text>
      </Box>
    )

    const contextValue =
      snap === null || snap.contextTokens === null ? '…' : `${tokens(snap.contextTokens)} · ${snap.contextPercent ?? 0}%`
    const turnValue =
      turn === null ? '…' : `${seconds(turn.durationMs)}${turn.costUsd === null ? '' : ` · $${turn.costUsd.toFixed(2)}`}`
    const cacheValue = turn?.cacheHit == null ? '…' : `${turn.cacheHit}%`

    // Running agents first, then the latest finished ones, on one time axis.
    const shown = [...cards.filter(c => c.status === 'running'), ...cards.filter(c => c.status !== 'running').reverse()]
      .slice(0, LANE_ROWS)
    const t0 = Math.min(now, ...shown.map(c => c.spawnedAt))
    const tEnd = shown.some(c => c.status === 'running') ? now : Math.max(t0 + 1000, ...shown.map(c => c.endedAt ?? now))
    const agentStatus = (c: AgentCard) =>
      c.status === 'running'
        ? `${c.steps} steps · ${seconds(now - c.spawnedAt)}`
        : c.status === 'done'
          ? `done ${seconds((c.endedAt ?? now) - c.spawnedAt)}`
          : c.status === 'stopped'
            ? 'stopped'
            : 'failed'
    const agentTone = (c: AgentCard) =>
      c.status === 'running' ? 'suggestion' : c.status === 'done' ? 'success' : c.status === 'failed' ? 'error' : undefined

    const sessionState = (r: SessionRow): { text: string; color?: 'error' | 'warning' | 'suggestion' } =>
      r.state === 'waiting'
        ? { text: `waiting ${span(r.sinceMs)}`, color: 'error' }
        : r.state === 'working'
          ? { text: 'running', color: 'suggestion' }
          : r.state === 'cold'
            ? { text: 'cache cold' }
            : r.state === 'new'
              ? { text: 'no turn yet' }
            : r.coldInMs !== null && r.coldInMs <= leadMs
              ? { text: `cold in ${span(r.coldInMs)}`, color: 'warning' }
              : { text: `idle ${span(r.sinceMs)}` }

    if (Svg !== null) {
      const width = Math.max(280, Math.floor(columns * CELL_PX))
      const { svg, height } = drawDeck(
        {
          tiles: [
            {
              name: 'context',
              icon: 'gauge',
              value: contextValue,
              accent: hueOf(tone(snap?.contextPercent ?? null, CONTEXT_WARN_AT)) ?? 'blue',
              meter: snap?.contextPercent ?? undefined,
            },
            { name: 'turn', value: turnValue, accent: 'purple', icon: 'bolt' },
            {
              name: 'cache',
              icon: 'database',
              value: cacheValue,
              accent: turn?.cacheHit == null ? 'gray' : turn.cacheHit >= 80 ? 'green' : turn.cacheHit >= 50 ? 'amber' : 'red',
              meter: turn?.cacheHit ?? undefined,
            },
          ],
          agentsNote: cards.length === 0 ? '' : `${cards.filter(c => c.status === 'running').length} running · ${cards.length} total`,
          agents: shown.map(c => ({
            card: c,
            status: agentStatus(c),
            tone: c.status === 'running' ? 'blue' : c.status === 'done' ? 'green' : c.status === 'failed' ? 'red' : 'gray',
          })),
          t0,
          tEnd,
          now,
          sessions: rows.map(r => {
            const st = sessionState(r)
            return {
              row: r,
              state: st.text,
              tone: st.color === 'error' ? 'red' : st.color === 'warning' ? 'amber' : st.color === 'suggestion' ? 'blue' : r.state === 'idle' ? 'green' : null,
            }
          }),
          log: lines.slice(-LOG_ROWS).reverse().map(l => ({ line: l, time: clock(l.at) })),
        },
        width,
        PALETTES[options.theme === 'dark' ? 'dark' : 'light'],
      )
      return (
        <Box flexDirection="column">
          <Svg source={svg} alt="Session deck: context, agents, sessions, log" width={width} height={height} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          {tile('context', contextValue, tone(snap?.contextPercent ?? null, CONTEXT_WARN_AT))}
          {tile('turn', turnValue)}
          {tile('cache', cacheValue)}
        </Box>

        {heading('Agents', cards.length === 0 ? '' : `${cards.filter(c => c.status === 'running').length} running · ${cards.length} total`)}
        {shown.length === 0 && <Text size="footnote" dimColor>No agents in this session yet.</Text>}
        {shown.map(c => (
          <Box key={c.id} flexDirection="row" alignItems="center" width="100%" columnGap={1}>
            <Box width={22} flexShrink={0} flexDirection="column">
              <Text size="footnote" wrap="truncate-end">{c.description || c.type}</Text>
              <Text size="caption" dimColor wrap="truncate-end">{c.type}</Text>
            </Box>
            <Box flexGrow={1}>
              <Text color={agentTone(c)}>{c.status === 'running' ? '▶' : '■'}</Text>
            </Box>
            <Box flexShrink={0} width={11} justifyContent="flex-end">
              <Text size="footnote" color={agentTone(c)}>{agentStatus(c)}</Text>
            </Box>
          </Box>
        ))}

        {heading('Sessions', `${rows.length}`)}
        {rows.map(r => {
          const s = sessionState(r)
          return (
            <Box key={r.id} flexDirection="row" justifyContent="space-between" alignItems="center" width="100%">
              <Box flexDirection="row" flexShrink={1} columnGap={1}>
                <Text size="footnote" color={s.color ?? 'inactive'}>●</Text>
                <Text size="footnote" weight={r.isSelf ? 'semibold' : 'regular'} wrap="truncate-end">{r.label}</Text>
                {r.dir !== r.label && <Text size="footnote" dimColor wrap="truncate-end">{r.dir}</Text>}
              </Box>
              <Box marginLeft={2} flexShrink={0}>
                <Text size="footnote" color={s.color} dimColor={s.color === undefined}>{s.text}</Text>
              </Box>
            </Box>
          )
        })}

        {heading('Log')}
        {lines.length === 0 && <Text size="footnote" dimColor>No events yet.</Text>}
        {lines.slice(-LOG_ROWS).reverse().map(l => (
          <Box flexDirection="row" columnGap={1}>
            <Text size="caption" mono dimColor>{clock(l.at)}</Text>
            <Text size="caption" mono wrap="truncate-end" color={l.tone ?? undefined} dimColor={l.tone === null}>
              {l.text}
            </Text>
          </Box>
        ))}
      </Box>
    )
  })
}
