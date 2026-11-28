import { expect, mock, test, type Engine } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'

const INBOX = '/h/.claude/session-band/inbox/me'
const HANDLED = '/h/.claude/session-band/handled'
const BEATS = '/h/.claude/session-band/sessions'
const BAND_PROPS = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }

const beat = (id: string, label: string, lastTurnAt: number | null, waiting: unknown = null) =>
  JSON.stringify({ id, label, dir: 'p', at: 0, lastTurnAt, isWorking: false, ttlMs: 3_600_000, waiting, controls: 1 })

// Stands in for the engine beneath the mod: a session "me" with no git, no flag file and an
// inbox that holds `files` until the mod removes them.
const engine = (on: On, files: Map<string, string>, ran: string[], toasts: string[] = [], paneLog: string[] = []) => {
  const panes = new Set<string>()
  const clock = mock.clock(on)
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/h' : undefined }))
  on('session.id', () => ({ value: 'me' }))
  on('session.cwd', () => ({ value: '/w/proj' }))
  on('session.turns', () => ({ value: 0 }))
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: [], context: { window: 200_000 } },
  }))
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.list', (_, e) => ({
    value: [...files.keys()]
      .filter(p => p.slice(0, p.lastIndexOf('/')) === e.path)
      .map(p => ({ name: p.slice(p.lastIndexOf('/') + 1), kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('process.run', (_, e) => {
    if (e.argv[0] === 'rm') files.delete(e.argv[e.argv.length - 1] ?? '')
    if (e.argv[0] === 'find' && e.argv.includes('me.jsonl')) {
      return { value: { exitCode: 0, stdout: '/h/.claude/projects/-w-proj/me.jsonl\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.argv[0] === 'grep') {
      const found = (files.get(e.argv[e.argv.length - 1] ?? '') ?? '').match(new RegExp(e.argv[e.argv.length - 2] ?? '', 'g')) ?? []
      return { value: { exitCode: found.length ? 0 : 1, stdout: found.join('\n'), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return {
      value: { exitCode: e.argv[0] === 'git' ? 1 : 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.run', (_, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  on('prompt.submit', (_, e) => {
    ran.push(`prompt:${e.text}`)
    return { text: e.text }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', (_, e) => {
    panes.add(e.id)
    paneLog.push(`open:${e.id}`)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    panes.delete(e.id)
    paneLog.push(`close:${e.id}`)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...panes].map((id, i, all) => ({ id, title: id, isShown: i === all.length - 1, isFocused: false, isPlaced: true })),
  }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return clock
}

const press = (files: Map<string, string>, verb: string, waitId: string | null, answers?: Record<string, string>) =>
  files.set(`${INBOX}/1-${verb}.json`, JSON.stringify({ id: `1-${verb}`, verb, waitId, from: 'other', at: 0, answers }))

test('an Accept pressed in another session answers the open question', async ($, on) => {
  const files = new Map<string, string>()
  const clock = engine(on, files, [])
  // The dialog: core never answers while the person is away.
  let dialogId = ''
  on('tool.call', (_, e) => {
    dialogId = e.tool_use_id
    return new Promise(() => undefined)
  })
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })

  const asked = $.tool.call({
    tool: 'AskUserQuestion',
    questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] }],
  } as Parameters<EngineInterface['tool']['call']>[0])
  await clock.settle()
  press(files, 'accept', dialogId)
  await clock.advance(2500)

  const answered = await asked
  expect(answered.deny).toMatch(/pressed Accept/)
  expect([...files.keys()].filter(k => k.startsWith(INBOX))).toEqual([])
})

test('a Compact pressed in another session runs /compact here', async ($, on) => {
  const files = new Map<string, string>()
  const ran: string[] = []
  const clock = engine(on, files, ran)
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })

  press(files, 'compact', null)
  await clock.advance(2500)

  expect(ran).toContain('compact')
  expect([...files.keys()].filter(k => k.startsWith(INBOX))).toEqual([])
})

test('a Save-brain pressed in another session submits save-brain here', async ($, on) => {
  const files = new Map<string, string>()
  const ran: string[] = []
  const clock = engine(on, files, ran)
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })

  press(files, 'save-brain', null)
  await clock.advance(2500)

  expect(ran.some(r => r.startsWith('prompt:save-brain'))).toBe(true)
  expect([...files.keys()].filter(k => k.startsWith(INBOX))).toEqual([])
})

test('a command left behind by a gone sender is dropped', async ($, on) => {
  const files = new Map<string, string>()
  const ran: string[] = []
  const clock = engine(on, files, ran)
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })
  await clock.advance(60_000)

  press(files, 'compact', null)
  await clock.advance(2500)

  expect(ran).not.toContain('compact')
  expect([...files.keys()].filter(k => k.startsWith(INBOX))).toEqual([])
})

test('a press hides its alert until the peer moves on, and brings it back when nobody picks it up', async ($, on) => {
  const files = new Map<string, string>()
  const clock = engine(on, files, [])
  // A peer idle 55 minutes of a 1h cache: its cold alert shows.
  const lastTurnAt = -55 * 60_000
  files.set(
    '/h/.claude/session-band/sessions/peer1.json',
    JSON.stringify({ id: 'peer1', label: 'Peer one', dir: 'p', at: 0, lastTurnAt, isWorking: false, ttlMs: 3_600_000, waiting: null, controls: 1 }),
  )
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'session-band',
    component: 'AbovePrompt',
    surface: 'desktop',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect(await ui.find({ type: 'Button', key: 'compact-peer1' })).toBeDefined()

  await ui.press({ key: 'compact-peer1' })
  expect(await ui.find({ type: 'Button', key: 'compact-peer1' })).toBeUndefined()
  // Every other session's band reads this mark and hides the alert too.
  expect(files.has(`${HANDLED}/peer1@cold@${lastTurnAt}`)).toBe(true)

  // The peer never reads its inbox: past the stale window the alert is back.
  await clock.advance(8000)
  expect(await ui.find({ type: 'Button', key: 'compact-peer1' })).toBeDefined()
  expect(files.has(`${HANDLED}/peer1@cold@${lastTurnAt}`)).toBe(false)
  await ui.unmount()
})

test('an alert pressed in another session is hidden here too', async ($, on) => {
  const files = new Map<string, string>()
  engine(on, files, [])
  const lastTurnAt = -55 * 60_000
  files.set(`${BEATS}/peer1.json`, beat('peer1', 'Peer one', lastTurnAt))
  files.set(`${HANDLED}/peer1@cold@${lastTurnAt}`, '{}')
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'session-band', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  expect(await ui.find({ type: 'Button', key: 'compact-peer1' })).toBeUndefined()
  await ui.unmount()
})

test('a peer waiting or going cold shows on the band only, with no toast', async ($, on) => {
  const files = new Map<string, string>()
  const toasts: string[] = []
  const clock = engine(on, files, [], toasts)
  files.set(`${BEATS}/peer1.json`, beat('peer1', 'Peer one', -55 * 60_000))
  files.set(`${BEATS}/peer2.json`, beat('peer2', 'Peer two', null, { id: 'w1', tool: 'AskUserQuestion', summary: 'q', since: 0 }))
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })
  await clock.advance(16_000)

  const ui = await $.ui.mount({ plugin: 'session-band', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  expect(await ui.find({ type: 'Button', key: 'accept-peer2' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'compact-peer1' })).toBeDefined()
  expect(toasts.filter(t => t.includes('Peer'))).toEqual([])
  // Workspace first, then the session's name.
  expect(await ui.find({ type: 'Text', text: /^Peer one$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Peer two$/ })).toBeDefined()
  expect(await ui.find({ key: 'chip-peer1' })).toBeDefined()
  expect(await ui.find({ key: 'chip-peer2' })).toBeDefined()
  await ui.unmount()
})

test('the heartbeat names the session by its title in the app', async ($, on) => {
  const files = new Map<string, string>()
  engine(on, files, [])
  files.set(
    '/h/.claude/projects/-w-proj/me.jsonl',
    ['{"type":"custom-title","customTitle":"Old name","sessionId":"me"}', '{"type":"user"}', '{"type":"custom-title","customTitle":"Autodeploy \\"v5\\"","sessionId":"me"}'].join('\n'),
  )
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })

  expect(JSON.parse(files.get(`${BEATS}/me.json`) ?? '{}').label).toBe('Autodeploy "v5"')
})

test('a side chat writes no heartbeat, and side chats on other bands are not listed', async ($, on) => {
  const files = new Map<string, string>()
  const clock = engine(on, files, [])
  files.set(
    '/h/.claude/projects/-w-proj/me.jsonl',
    ['{"type":"custom-title","customTitle":"Parent work","sessionId":"parent"}', '{"type":"custom-title","customTitle":"Side chat","sessionId":"me"}'].join('\n'),
  )
  files.set(`${BEATS}/me.json`, beat('me', 'Parent work', 0))
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })
  await clock.advance(16_000)
  expect(files.has(`${BEATS}/me.json`)).toBe(false)
})

test('a peer whose title marks a side chat is not listed or alerted', async ($, on) => {
  const files = new Map<string, string>()
  const clock = engine(on, files, [])
  files.set(`${BEATS}/side1.json`, beat('side1', 'btw: what is X', -55 * 60_000))
  files.set(`${BEATS}/side2.json`, beat('side2', 'Side chat', null, { id: 'w1', tool: 'AskUserQuestion', summary: 'q', since: 0 }))
  files.set(`${BEATS}/peer1.json`, beat('peer1', 'Peer one', -55 * 60_000))
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })
  await clock.advance(16_000)

  const ui = await $.ui.mount({ plugin: 'session-band', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  expect(await ui.find({ type: 'Button', key: 'compact-peer1' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'compact-side1' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'accept-side2' })).toBeUndefined()
  await ui.unmount()
})

test('an Accept that finds nothing waiting brings the alert back for every session', async ($, on) => {
  const files = new Map<string, string>()
  const clock = engine(on, files, [])
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })
  files.set(`${HANDLED}/me@wait@w1`, '{}')

  press(files, 'accept', 'w1')
  await clock.advance(2500)

  expect(files.has(`${HANDLED}/me@wait@w1`)).toBe(false)
})

const COLOUR = { question: 'Which colour?', header: 'Colour', options: ['Red', 'Blue'], multiSelect: false, descriptions: ['', ''] }
const ASKING = { id: 'w1', tool: 'AskUserQuestion', summary: 'Which colour?', since: 0, questions: [COLOUR] }
const ALERT_PANE = {
  plugin: 'session-band',
  component: 'Pane',
  requestId: 'session-alert',
  surface: 'desktop',
  props: { title: 'Alert', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('hovering an alert reveals the full name and the question', async ($, on) => {
  const files = new Map<string, string>()
  engine(on, files, [])
  files.set(`${BEATS}/peer2.json`, beat('peer2', 'Peer two', null, ASKING))
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'session-band', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  expect(await ui.find({ type: 'Text', text: /^Which colour\?$/ })).toBeDefined()
  await ui.unmount()
})

test('Open shows the question in a pane, and an option pressed there answers it in that session', async ($, on) => {
  const files = new Map<string, string>()
  engine(on, files, [])
  files.set(`${BEATS}/peer2.json`, beat('peer2', 'Peer two', null, ASKING))
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })

  const band = await $.ui.mount({ plugin: 'session-band', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  await band.press({ key: 'open-peer2' })
  const pane = await $.ui.mount(ALERT_PANE)
  expect(await pane.find({ type: 'Text', text: /Which colour\?/ })).toBeDefined()
  await pane.press({ key: 'opt-0-1' })

  const sent = [...files.entries()].filter(([k]) => k.startsWith('/h/.claude/session-band/inbox/peer2/'))
  expect(sent.length).toBe(1)
  const command = JSON.parse(sent[0]?.[1] ?? '{}')
  expect(command.verb).toBe('answer')
  expect(command.waitId).toBe('w1')
  expect(command.answers).toEqual({ 'Which colour?': 'Blue' })
  await pane.unmount()
  await band.unmount()
})

test('an answer pressed in another session settles the question with that option', async ($, on) => {
  const files = new Map<string, string>()
  const clock = engine(on, files, [])
  let dialogId = ''
  on('tool.call', (_, e) => {
    dialogId = e.tool_use_id
    return new Promise(() => undefined)
  })
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })

  const asked = $.tool.call({
    tool: 'AskUserQuestion',
    questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] }],
  } as Parameters<EngineInterface['tool']['call']>[0])
  await clock.settle()
  // The heartbeat carries the whole question, options included, for the other bands' pane.
  const waiting = JSON.parse(files.get(`${BEATS}/me.json`) ?? '{}').waiting
  expect(waiting.questions).toEqual([COLOUR])

  press(files, 'answer', dialogId, { 'Which colour?': 'Blue' })
  await clock.advance(2500)

  const answered = await asked
  expect(answered.deny).toMatch(/"Which colour\?" → "Blue"/)
})

test('Deck opens the deck, and a second press closes it', async ($, on) => {
  const files = new Map<string, string>()
  const paneLog: string[] = []
  engine(on, files, [], [], paneLog)
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })

  const band = await $.ui.mount({ plugin: 'session-band', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  await band.press({ key: 'deck' })
  await band.press({ key: 'deck' })
  expect(paneLog).toEqual(['open:session-deck', 'close:session-deck'])
  await band.unmount()
})

test("Details opens an alert's pane, a second press closes it, another alert's press switches it", async ($, on) => {
  const files = new Map<string, string>()
  const paneLog: string[] = []
  engine(on, files, [], [], paneLog)
  files.set(`${BEATS}/peer1.json`, beat('peer1', 'Peer one', -55 * 60_000))
  files.set(`${BEATS}/peer2.json`, beat('peer2', 'Peer two', null, ASKING))
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })

  const band = await $.ui.mount({ plugin: 'session-band', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  await band.press({ key: 'open-peer1' })
  await band.press({ key: 'open-peer2' })
  const pane = await $.ui.mount(ALERT_PANE)
  expect(await pane.find({ type: 'Text', text: /Which colour\?/ })).toBeDefined()
  await band.press({ key: 'open-peer2' })
  expect(paneLog).toEqual(['open:session-alert', 'open:session-alert', 'close:session-alert'])
  await pane.unmount()
  await band.unmount()
})

test("a cold alert's Details shows the peer's last prompt, last save-brain and context", async ($, on) => {
  const files = new Map<string, string>()
  engine(on, files, [])
  const peer = { ...JSON.parse(beat('peer1', 'Peer one', -55 * 60_000)), lastPrompt: 'fix the login bug', savedAt: -50 * 60_000, contextPercent: 42 }
  files.set(`${BEATS}/peer1.json`, JSON.stringify(peer))
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })

  const band = await $.ui.mount({ plugin: 'session-band', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  await band.press({ key: 'open-peer1' })
  const pane = await $.ui.mount(ALERT_PANE)
  expect(await pane.find({ type: 'Text', text: /Last prompt: fix the login bug/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Last save-brain/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /context 42%/ })).toBeDefined()
  await pane.unmount()
  await band.unmount()
})

test("the person's prompt and a save-brain turn land in this session's heartbeat", async ($, on) => {
  const files = new Map<string, string>()
  const clock = engine(on, files, [])
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })
  await runTurn($, 'fix the login bug', 'composer')
  press(files, 'save-brain', null)
  await clock.advance(2500)
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1000 } as never)

  const me = JSON.parse(files.get(`${BEATS}/me.json`) ?? '{}')
  expect(me.lastPrompt).toBe('fix the login bug')
  expect(typeof me.savedAt).toBe('number')
})

test('Send answers pressed before every question has a pick says which one is missing', async ($, on) => {
  const files = new Map<string, string>()
  engine(on, files, [])
  const second = { question: 'Which size?', header: 'Size', options: ['S', 'L'], multiSelect: false }
  files.set(`${BEATS}/peer2.json`, beat('peer2', 'Peer two', null, { ...ASKING, questions: [COLOUR, second] }))
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })

  const band = await $.ui.mount({ plugin: 'session-band', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  await band.press({ key: 'open-peer2' })
  const pane = await $.ui.mount(ALERT_PANE)
  await pane.press({ key: 'opt-0-1' })
  await pane.press({ key: 'send' })
  expect(await pane.find({ key: 'missing-1' })).toBeDefined()
  expect(await pane.find({ key: 'missing-0' })).toBeUndefined()
  expect([...files.keys()].some(k => k.startsWith('/h/.claude/session-band/inbox/peer2/'))).toBe(false)

  await pane.press({ key: 'opt-1-0' })
  await pane.press({ key: 'send' })
  const sent = [...files.entries()].find(([k]) => k.startsWith('/h/.claude/session-band/inbox/peer2/'))
  expect(JSON.parse(sent?.[1] ?? '{}').answers).toEqual({ 'Which colour?': 'Blue', 'Which size?': 'S' })
  await pane.unmount()
  await band.unmount()
})

// A save-brain turn is itself a turn: it starts a new idle period. That period needs no
// reminder, since the state was just saved, until a prompt of the person's starts a new one.
const runTurn = async ($: Engine, text: string, origin: string) => {
  await $.prompt.submit({ text, origin: { kind: origin } } as never)
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1000 } as never)
}

test('a save-brain turn leaves its idle period without a cold reminder, here and on other bands', async ($, on) => {
  const files = new Map<string, string>()
  const toasts: string[] = []
  const clock = engine(on, files, [], toasts)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })
  await runTurn($, 'save-brain: save the session state now (save-state).', 'plugin')
  await clock.advance(55 * 60_000)

  expect(JSON.parse(files.get(`${BEATS}/me.json`) ?? '{}').isSaved).toBe(true)
  expect(toasts.filter(t => t.includes('cold'))).toEqual([])
  const ui = await $.ui.mount({ plugin: 'session-band', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  expect(await ui.find({ type: 'Text', text: /cold in/ })).toBeUndefined()
  await ui.unmount()
})

// The engine never hands a plugin's own $.prompt.submit to that plugin's prompt.submit hook,
// so the turn a Save-brain press starts must be marked saved by the press itself.
test('a Save-brain press marks the turn it starts as saved without hearing its own prompt', async ($, on) => {
  const files = new Map<string, string>()
  const clock = engine(on, files, [])
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })
  press(files, 'save-brain', null)
  await clock.advance(2500)
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1000 } as never)
  await clock.advance(55 * 60_000)

  expect(JSON.parse(files.get(`${BEATS}/me.json`) ?? '{}').isSaved).toBe(true)
})

test('a prompt after save-brain brings the cold reminder back for its own idle period', async ($, on) => {
  const files = new Map<string, string>()
  const clock = engine(on, files, [])
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })
  await runTurn($, 'save-brain: save the session state now (save-state).', 'plugin')
  await runTurn($, 'next task', 'composer')
  await clock.advance(55 * 60_000)

  expect(JSON.parse(files.get(`${BEATS}/me.json`) ?? '{}').isSaved).toBe(false)
})

test('a peer whose last turn saved its state raises no cold alert', async ($, on) => {
  const files = new Map<string, string>()
  const clock = engine(on, files, [])
  files.set(`${BEATS}/peer1.json`, JSON.stringify({ ...JSON.parse(beat('peer1', 'Peer one', -55 * 60_000)), isSaved: true }))
  await $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })
  await clock.advance(16_000)

  const ui = await $.ui.mount({ plugin: 'session-band', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS })
  expect(await ui.find({ key: 'chip-peer1' })).toBeUndefined()
  await ui.unmount()
})
