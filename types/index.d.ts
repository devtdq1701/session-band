export type Limit = { kind: string; percent: number; resetsAt: string | null }

export type Snapshot = {
  at: number
  startedAt: number
  prompts: number
  dir: string
  branch: string | null
  isWorktree: boolean
  ahead: number
  behind: number
  changed: number
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  costUsd: number | null
  limits: Limit[]
  isGoalMode: boolean
}

export type TurnStat = {
  at: number
  durationMs: number
  model: string | null
  cacheHit: number | null
  costUsd: number | null
}

// One AskUserQuestion question as another session's pane draws it.
export type Question = {
  question: string
  header: string
  options: string[]
  multiSelect: boolean
  // Each option's description, by index; absent on older code.
  descriptions?: string[]
}

// A call this session is waiting on the person for: a question or a plan.
export type Waiting = {
  id: string
  tool: string
  summary: string
  since: number
  reason?: string
  // AskUserQuestion's questions, so another session can answer them; absent on older code.
  questions?: Question[]
}

// One session's heartbeat file under ~/.claude/session-band/sessions/<id>.json.
export type Beat = {
  id: string
  label: string
  dir: string
  at: number
  lastTurnAt: number | null
  isWorking: boolean
  ttlMs: number
  waiting?: Waiting | null
  // Inbox protocol this session polls (~/.claude/session-band/inbox/<id>/); absent on older code.
  controls?: number
  // The last turn was a save-brain: its idle period needs no cold reminder. Absent on older code.
  isSaved?: boolean
}

// One press in another session's band, written to this session's inbox and run here.
export type Command = {
  id: string
  verb: 'compact' | 'save-brain' | 'accept' | 'decline' | 'answer'
  // The Waiting.id an accept or decline answers; null for compact and save-brain.
  waitId: string | null
  from: string
  at: number
  // An answer's chosen labels by question text, several comma-joined.
  answers?: Record<string, string>
}

// A session that needs the person: waiting on them, or its prompt cache about to go cold.
export type Peer = {
  id: string
  label: string
  dir: string
  lastTurnAt: number | null
  coldInMs: number | null
  waiting: Waiting | null
  // Whether the peer polls its inbox, so the band may draw buttons that act on it.
  hasControls: boolean
}

// Every live session, this one included, for the deck's session list.
export type SessionRow = {
  id: string
  label: string
  dir: string
  isSelf: boolean
  state: 'working' | 'waiting' | 'idle' | 'cold' | 'new'
  sinceMs: number
  coldInMs: number | null
}

export type AgentCard = {
  id: string
  type: string
  description: string
  spawnedAt: number
  endedAt: number | null
  status: 'running' | 'done' | 'stopped' | 'failed'
  steps: number
  ctxTokens: number
  outTokens: number
}

export type LogLine = { at: number; text: string; tone: 'error' | 'warning' | 'success' | null }

declare module 'claude-code' {
  interface PluginState {
    'session-band': {
      snap: Shaped<Snapshot | null>
      lastTurn: Shaped<TurnStat | null>
      isWorking: boolean
      warned: string[]
      label: string | null
      title: string | null
      peers: Shaped<Peer[]>
      pending: Waiting[]
      sessions: SessionRow[]
      agents: AgentCard[]
      log: LogLine[]
      turnCostStart: number | null
      saveBrainSentAt: number | null
      isSaveTurn: boolean
      savedTurnAt: number | null
      hiddenAlerts: string[]
      alertPeer: string | null
      choices: Record<string, string[]>
      alertTried: boolean
    }
  }
}
