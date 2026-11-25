import { expect, mock, test } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'

const INBOX = '/h/.claude/session-band/inbox/me'

// Stands in for the engine beneath the mod: a session "me" with no git, no flag file and an
// inbox that holds `files` until the mod removes them.
const engine = (on: On, files: Map<string, string>, ran: string[]) => {
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
  on('ui.toast', () => ({ value: undefined }))
  return clock
}

const press = (files: Map<string, string>, verb: string, waitId: string | null) =>
  files.set(`${INBOX}/1-${verb}.json`, JSON.stringify({ id: `1-${verb}`, verb, waitId, from: 'other', at: 0 }))

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

  // The peer never reads its inbox: past the stale window the alert is back.
  await clock.advance(8000)
  expect(await ui.find({ type: 'Button', key: 'compact-peer1' })).toBeDefined()
  await ui.unmount()
})
