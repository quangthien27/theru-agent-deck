# AgentDeck

**Command your AI fleet.**

AgentDeck transforms your Logitech MX Creative Console into a mission control interface for AI coding agents like Claude Code. Monitor multiple agents, see full diffs before approving, and control everything with physical buttons and dials.

![AgentDeck Mockup](assets/mockups/agentdeck-main.png)

---

## The Problem

Developers are running multiple AI coding agents in parallel—one refactoring, one writing tests, one debugging. But these agents live in terminals with zero visual feedback.

You're constantly:
- Tab-switching to check "is it done yet?"
- Scrolling up to find missed approval prompts
- Losing track of which agent needs attention
- Breaking flow to manage your AI helpers

**The agents are smart. The interaction model is from 1975.**

---

## The Solution

AgentDeck provides real-time visibility and physical controls for managing multiple AI coding agents — Claude Code, Gemini, Codex, Aider, and OpenCode. No external dependencies, no tmux — agents run as native terminals in VS Code, Windsurf, or Cursor.

### Works Where You Work

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│   VS Code  ─────────┐                                           │
│                      │                                           │
│   Windsurf ─────────┼──▶  AgentDeck  ──▶  MX Creative Console   │
│                      │                                           │
│   Cursor ───────────┘                                           │
│                                                                  │
│   Multiple windows. One control surface.                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Three-Layer Interaction

**Layer 1: LCD Keypad — Visual Dashboard**

```
┌───────────┬───────────┬───────────┐
│ 🟢 JW     │ 🟡 AFH    │ 🔴 SNAP   │  ← Agent status at a glance
│ idle      │ working   │ APPROVE!  │
├───────────┼───────────┼───────────┤
│ 🟢 API    │ ⚫ --     │ ⚫ --     │  ← Up to 6 agents
│ idle      │           │           │
├───────────┼───────────┼───────────┤
│   NEW     │  STATUS   │  CUSTOM   │  ← Quick actions
└───────────┴───────────┴───────────┘
```

**Tap** an agent to see details. **Hold** to open its terminal directly.

**Layer 2: Actions Ring — Full Context**

When you tap an agent, the Ring shows everything you need:

```
╭─────────────────────────────────────────╮
│  SNAP - Edit src/auth.ts                │
│  ───────────────────────                │
│                                         │
│  - async function validateToken(token)  │
│  + async function validateToken(token): │
│  +   Promise<boolean> {                 │
│      const decoded = jwt.verify(...     │
│  +   if (!decoded) return false;        │
│                                         │
│  File 1/3        +2 -1 lines   $0.02    │
│       [YES ✓]        [NO ✗]             │
╰─────────────────────────────────────────╯
```

See the full diff. Make informed decisions. No more blind approvals.

**Layer 3: Dialpad — Physical Control**

Navigate and act without looking at the keyboard:

```
[UNDO]              [PAUSE]

         ╭──────────╮    
         │   DIAL   │   ← Scroll through diff
         ╰──────────╯    
                         [ROLLER] ← Navigate files

[YES ✓]              [NO ✗]
```

### Instant Status Detection

AgentDeck detects agent state changes using standard terminal escape sequences. When Claude Code needs approval, it sends a terminal bell character. AgentDeck intercepts this instantly — no polling, no delay. Your console tile turns yellow and your MX Master 4 buzzes the moment the agent needs you.

### Auto-Attach — Zero Configuration

Type `claude`, `gemini`, `aider`, `codex`, or `opencode` in any terminal. AgentDeck detects the command via VS Code's Shell Integration API, auto-attaches the terminal, and streams output for full status detection. No special setup — just launch agents however you normally do.

### MX Master 4 Haptics — Ambient Awareness

| Event | Feedback |
|-------|----------|
| Agent needs approval | Haptic buzz (instant via BEL detection) |
| Task completed | Haptic pulse |
| Error occurred | Haptic alert |

*Feel when something needs attention—even when you're not looking.*

---

## Architecture

No external dependencies — no tmux, no bridge process, no daemon. The VS Code extension IS the server.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│   ┌──────────────────────────────────────────────────────┐       │
│   │       VS Code / Windsurf / Cursor (per window)       │       │
│   │                                                       │       │
│   │  Extension:                                           │       │
│   │  • Spawns agents via node-pty + Pseudoterminal       │       │
│   │  • Captures output for status detection              │       │
│   │  • WebSocket server (:9999-10008, one port/window)   │       │
│   │  • Sidebar, diff viewer, commands                    │       │
│   └───────────────────────┬──────────────────────────────┘       │
│                           │ WebSocket (per window)               │
│                           ▼                                      │
│   ┌───────────────────────────────────────────────────┐          │
│   │           Logi Plugin (C# / Actions SDK)          │          │
│   │                                                    │          │
│   │  • BridgeMultiClient: connects to ALL windows     │          │
│   │  • Merges agent state from all windows            │          │
│   │  • Routes commands to correct window              │          │
│   │  • LCD tile rendering, haptic feedback            │          │
│   └───────────────────────┬───────────────────────────┘          │
│                           │                                      │
└───────────────────────────┼──────────────────────────────────────┘
                            ▼
                 MX Creative Console
                    + MX Master 4
```

**Multi-window:** Each editor window runs its own extension instance on a unique port. The Logi plugin discovers all active windows, merges their agent state, and routes commands by agent ID prefix. Focus a window, press NEW on the console — agent spawns in that window.

---

## Quick Start

### Prerequisites

- macOS (Windows support planned)
- [Logi Options+](https://www.logitech.com/software/logi-options-plus.html) installed
- Logitech MX Creative Console (+ MX Master 4 for haptics)
- VS Code, Windsurf, or Cursor
- At least one AI coding agent CLI installed (claude, gemini, codex, aider, opencode)

### Installation

```bash
# 1. Install the Logi plugin
# Download AgentDeck.lplug4 from Releases → double-click to install

# 2. Install the VS Code extension
# In VS Code/Windsurf/Cursor: Extensions → ⋯ → Install from VSIX → select agentdeck-*.vsix

# 3. Assign "Agent Deck" folder to an LCD button in Logi Options+

# 4. Open a project, tap the button — you're in!
```

Agents launched from the console or command palette run as native editor terminals. No tmux, no bridge, no configuration files needed.

---

## User Workflows

### Workflow 1: Start Fresh Session

**Scenario:** You sit down to work. No agents running yet.

```
KEYPAD SHOWS:
┌───────┬───────┬───────┐
│ ⚫ -- │ ⚫ -- │ ⚫ -- │  All slots empty
├───────┼───────┼───────┤
│ ⚫ -- │ ⚫ -- │ ⚫ -- │
├───────┼───────┼───────┤
│  NEW  │STATUS │CUSTOM │
└───────┴───────┴───────┘
```

**Steps:**

1. **Press NEW button**
   - Ring opens with project picker

2. **Use DIAL to scroll to your project**
   - "Frontend" highlighted

3. **Press YES on dialpad**
   - Bridge creates tmux session
   - Claude Code launches in ~/projects/frontend
   - Slot 1 turns GREEN (idle)

4. **Repeat for more agents**
   - Press NEW again
   - Select "API" project
   - Slot 2 lights up

**Result:**
```
┌───────┬───────┬───────┐
│🟢 FE  │🟢 API │ ⚫ -- │  Two agents ready
├───────┼───────┼───────┤
│ ⚫ -- │ ⚫ -- │ ⚫ -- │
├───────┼───────┼───────┤
│  NEW  │  2 ●  │CUSTOM │
└───────┴───────┴───────┘
```

---

### Workflow 2: Give Tasks to Agents

**Scenario:** Agents are running. You want to assign work.

**Option A: Via AgentDeck (Hold to Terminal)**

1. **HOLD the Frontend agent button** (500ms+)
   - Terminal window opens (tmux attach)
   - You see Claude Code prompt

2. **Type your task**
   - "Refactor the auth module to use JWT"

3. **Agent starts working**
   - Slot turns YELLOW (working)
   - You can close terminal - AgentDeck keeps monitoring

**Option B: Keep Terminal Open Separately**

```bash
# In your terminal:
tmux attach -t agentdeck

# Switch between windows (Ctrl+B, then 1/2/3)
# Give each agent a task

# Detach (Ctrl+B, D) or just minimize
# AgentDeck shows status on keypad
```

**Option C: VS Code Users**

1. Open VS Code terminals normally
2. Run `claude` in each terminal
3. AgentDeck auto-detects them
4. Give tasks in VS Code, monitor via AgentDeck

---

### Workflow 3: Handle Approvals (Core Use Case!)

**Scenario:** Agents are working. One needs approval.

```
KEYPAD SHOWS:
┌───────┬───────┬───────┐
│🟢 FE  │🟡 API │🔴 DOCS│  ← DOCS is RED (needs approval)
├───────┼───────┼───────┤    and PULSING
│ ⚫ -- │ ⚫ -- │ ⚫ -- │
├───────┼───────┼───────┤
│  NEW  │  3 ●  │CUSTOM │
└───────┴───────┴───────┘
         1 waiting

+ HAPTIC BUZZ on MX Master 4 (3 short pulses)
```

**Steps:**

1. **TAP the DOCS button** (red one)
   - Ring opens with full context

```
╭─────────────────────────────────────────────╮
│  DOCS - Edit README.md                      │
│  ───────────────────────                    │
│                                             │
│  - ## Installation                          │
│  + ## Quick Start                           │
│  +                                          │
│  + ### Prerequisites                        │
│  + - Node.js 18+                            │
│  + - Claude Code CLI                        │
│                                             │
│  File 1/2        +5 -1 lines                │
│       [YES ✓]        [NO ✗]                 │
╰─────────────────────────────────────────────╯
```

2. **Use ROLLER to see other files** (if multiple)
   - "File 2/2: CONTRIBUTING.md"

3. **Use DIAL to scroll within diff**
   - See all changes before deciding

4. **Press YES to approve** (or NO to reject)
   - Bridge sends "y" to the terminal
   - Agent continues working
   - DOCS slot turns YELLOW (working)
   - Ring closes, back to dashboard

---

### Workflow 4: Monitor Multiple Agents

**Scenario:** Three agents working. You're doing other work.

```
YOU'RE WORKING ON SOMETHING ELSE...
AgentDeck sits on your desk, visible in peripheral vision

┌───────┬───────┬───────┐
│🟡 FE  │🟡 API │🟡 DOCS│  All working - yellow glow
├───────┼───────┼───────┤
│ ⚫ -- │ ⚫ -- │ ⚫ -- │
├───────┼───────┼───────┤
│  NEW  │  3 ●  │CUSTOM │
└───────┴───────┴───────┘
```

**What you notice:**

- Colors change: Yellow → Green (done) or Red (needs you)
- Haptics buzz when approval needed
- No need to tab-switch or check terminals

**When something needs attention:**

1. Haptic buzz → glance at keypad
2. See which slot is red
3. Tap it, review in Ring, approve/reject
4. Back to your work in <10 seconds

---

### Workflow 5: Check Status & Costs

**Scenario:** Want to see overview of all agents.

1. **Press STATUS button**
   - Ring opens with all agents list

```
╭─────────────────────────────────────────────╮
│  All Agents (3 active)                      │
│  ───────────────────────                    │
│                                             │
│  🟢 Frontend    idle         $0.00         │
│  🟡 API         working (5m) $0.12         │
│  🟢 Docs        idle         $0.08         │
│                                             │
│  ─────────────────────────────────          │
│  Total: $0.20    0 waiting                  │
│  Session time: 47 minutes                   │
│                                             │
│       [SELECT]      [CLOSE]                 │
╰─────────────────────────────────────────────╯
```

2. **Use DIAL to scroll** if many agents

3. **Press YES on an agent** to open its detail Ring
   - Or press NO to close and return to dashboard

---

### Workflow 6: End of Day

**Scenario:** Done working. Want to shut down agents.

**Option A: Kill Individual Agent**

1. Tap agent button → Ring opens
2. Ring shows agent status with [KILL] option
3. Select KILL → confirms → agent terminated
4. Slot goes gray

**Option B: Kill All (if CUSTOM button configured)**

1. Press CUSTOM button (configured as "kill-all")
2. Confirmation in Ring: "Kill all 3 agents?"
3. Press YES → all agents terminated
4. All slots go gray

**Option C: Just Leave Them**

- tmux sessions persist even if you close everything
- Tomorrow: agents still there, resume where you left off
- AgentDeck reconnects automatically

---

## Logi Actions — All Assignable Actions

Assign these to MX Creative Console keypad, dialpad keys, or MX Master 4 Actions Ring via Logi Options+.

### Dynamic Folder

| Action | Group | Description |
|--------|-------|-------------|
| **Agent Deck** | Agents | Takes over all 9 LCD buttons. Dashboard with agent tiles, management page (double-tap), new agent picker, and menu. |

**Double-tap management page** (per-agent actions):

| Tile | Action | What it does |
|------|--------|-------------|
| Commit | Send commit prompt | Asks agent to commit current changes |
| Restart | Kill + relaunch | Same type, same project, re-creates worktree if needed |
| Checkpoint | Git tag save point | `git tag agentdeck/checkpoint/{id}/{timestamp}` |
| Diff | Open diff view | Shows this agent's changed files in VS Code |
| Continue | Send "continue" | Nudges agent to keep going |
| Mode | Cycle permission mode | Sends Shift+Tab (ask → auto → plan for Claude/Codex) |
| End | Kill session | Terminates the agent |

### Standalone Commands

| Action | Group | Description |
|--------|-------|-------------|
| **Quick Launch** | Agents | Launch agent with dropdown selector (Claude, Gemini, Codex, Aider, OpenCode) |
| **Agent Status** | Agents | Fleet overview tile — agent count with colored status dots |
| **Cycle Agent** | Navigation | Rotate selection to next agent + focus terminal |
| **Next Waiting** | Navigation | Jump to next waiting agent. Shows waiting count. |
| **Approve All** | Controls | Batch approve all waiting agents |

### Dial / Adjustment Actions

| Action | Group | Rotate | Press |
|--------|-------|--------|-------|
| **Agent Selector** | Navigation | Cycle through agents on dashboard | Focus selected agent's terminal |
| **Effort Level** | Controls | Cycle `/effort low/medium/high` on selected agent | Reset to medium |
| **Permission Mode** | Controls | Send Shift+Tab to cycle ask/auto/plan mode | Send one Shift+Tab |

### Haptics (MX Master 4)

| Event | Haptic Trigger |
|-------|---------------|
| Agent needs input | `agent_needs_input` — when any agent status → waiting |
| Agent completed | `agent_completed` — when agent finishes (working → idle) |
| Agent error | `agent_error` — when any agent status → error |

---

## Configuration

Create `~/.agentdeck/config.json`:

```json
{
  "projects": [
    { "name": "Frontend", "path": "~/projects/frontend" },
    { "name": "API", "path": "~/projects/api" },
    { "name": "Docs", "path": "~/projects/docs" }
  ],
  "defaultProject": "Frontend",
  "maxAgents": 6,
  "haptics": {
    "enabled": true,
    "approvalPattern": "short-short-short",
    "completionPattern": "long"
  },
  "customButton": {
    "action": "settings"
  },
  "sources": {
    "tmux": true,
    "vscode": true,
    "cursor": true
  }
}
```

### Custom Button Options

| Action | Description |
|--------|-------------|
| `settings` | Open AgentDeck settings |
| `terminal` | Open terminal for selected agent |
| `checkpoint` | Create git checkpoint |
| `cost` | Show cost summary |
| `kill-all` | Kill all agents |

---

## FAQ

**Q: Where do I type tasks for the agents?**

A: Hold the agent button to open terminal, or use `tmux attach -t agentdeck` separately.

**Q: Can I use VS Code instead of tmux?**

A: Yes! Install the VS Code extension. Run `claude` in VS Code terminals - they appear automatically.

**Q: What if I close my terminal?**

A: tmux sessions persist. AgentDeck keeps monitoring. Agents continue working.

**Q: How do I see the full terminal output?**

A: Hold the agent button to open terminal. Or `tmux attach -t agentdeck`.

**Q: Can I use this with Cursor?**

A: Yes, same as VS Code - install the extension and it works.

**Q: What happens if I restart my computer?**

A: tmux sessions are lost on restart. Press NEW to launch fresh agents. (Future: auto-restore option)

**Q: Can I have more than 6 agents?**

A: The keypad shows 6 slots. Press STATUS to see all agents if you have more. Use dial to scroll.

**Q: Does it work with other AI coding tools?**

A: Currently optimized for Claude Code. Aider and Codex CLI support planned for v2.0.

---

## Comparison

| Feature | AgentDeck | Conductor | Claw Control |
|---------|-----------|-----------|--------------|
| Multi-session (6+) | ✅ | ❌ (single) | ⚠️ |
| tmux support | ✅ | ❌ | ❌ |
| VS Code support | ✅ | ✅ | ❌ |
| Cursor support | ✅ | ❌ | ❌ |
| Full diff display | ✅ | ❌ | ❌ |
| Physical controls | ✅ | ✅ | ✅ |
| Cost tracking | ✅ | ❌ | ❌ |

---

## Roadmap

### v1.0 (Current)
- [x] 6 agent slots on keypad
- [x] Bridge with tmux adapter
- [x] Ring with diff display
- [x] Dialpad navigation
- [x] Approve/Reject flow
- [x] Hold-to-open-terminal
- [x] Haptic notifications

### v1.1
- [ ] VS Code extension
- [ ] Cursor support
- [ ] Git checkpoint integration
- [ ] Cost tracking display

### v2.0
- [ ] Codex CLI support
- [ ] Aider support
- [ ] Agent templates
- [ ] Team sync features

---

## Development

### Building from Source

```bash
# Clone
git clone https://github.com/pinkpixel-dev/agentdeck.git
cd agentdeck

# Bridge
cd packages/bridge
npm install
npm run build

# Plugin
cd ../logi-plugin
dotnet build

# VS Code Extension (optional)
cd ../vscode-extension
npm install
npm run compile
```

### Build All

```bash
# From repo root
./scripts/build-all.sh

# Package for release
./scripts/package-release.sh 1.0.0
```

### Running Tests

```bash
cd packages/bridge && npm test
cd packages/logi-plugin && dotnet test
```

---

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- Built for [DevStudio 2026 by Logitech](https://devstudiologitech2026.devpost.com/)
- Powered by [Logi Actions SDK](https://logitech.github.io/actions-sdk-docs/)
- Designed for [Claude Code](https://www.anthropic.com/claude-code)

---

<p align="center">
  <img src="assets/logo/agentdeck-icon.png" width="60" alt="AgentDeck Icon">
  <br>
  <strong>AgentDeck</strong> — Command your AI fleet.
</p>
