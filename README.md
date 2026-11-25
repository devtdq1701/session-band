# session-band

A Claude Code mod for the desktop app: a compact band above the prompt and a Session deck pane that keep every local session in view.

- **Band:** folder, branch, changed files, session time and cost estimate, context %, 5h/7d limits, prompt-cache state, running agents; Save (save-brain), Deck and Goal buttons.
- **Cross-session alerts:** when another local session is waiting on a question or plan (🔔) or its prompt cache is about to go cold (⏳), the band shows that session's name with buttons that act in that session: Accept / Decline for a question, Decline for a plan, Save-brain / Compact for a cold cache. A pressed alert hides at once and comes back with a toast if the other session does not pick the press up.
- **Session deck** (`/deck`): context, last turn and cache tiles, subagent lanes on a time axis, every live session, and an event log.
- **Goal mode** (`/goal-mode on|off|status`): toggles an unattended flag file that auto-denies questions.

Sessions find each other through heartbeat files in `~/.claude/session-band/sessions/`, and presses travel as command files in `~/.claude/session-band/inbox/<session id>/`, polled every 2 seconds. A session shows buttons for another only once both run this version (`/reload-plugins` or a restart). Cost figures are client-side estimates.

## Install

At the prompt of a terminal session:

```
/plugin install session-band --marketplace devtdq1701/session-band
```

From a shell:

```
claude plugin install session-band --marketplace devtdq1701/session-band
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `devtdq1701/session-band`, then Add plugin.

## Options

- `cache_ttl`: `1h` (Claude subscription within plan usage) or `5m` (API key or usage credits).
- `theme`: `light` or `dark`, the colours of the SVG-drawn deck.

## Notes

The save-brain button submits `save-brain: save the session state now (save-state).`, and goal mode uses the flag `~/.claude/hooks/unattended.on` (or `$CLAUDE_UNATTENDED_FLAG`); both follow the author's own workflow, so adapt them to yours.
