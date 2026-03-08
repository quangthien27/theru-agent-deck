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

AgentDeck provides real-time visibility and physical controls for managing multiple Claude Code sessions—whether they're running in tmux, VS Code, or Cursor.

### Works Where You Work

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│   tmux terminals ─────┐                                         │
│                       │                                         │
│   VS Code terminals ──┼──▶  AgentDeck  ──▶  MX Creative Console │
│                       │                                         │
│   Cursor terminals ───┘                                         │
│                                                                  │
│   One control surface. Any workflow.                            │
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

### MX Master 4 Haptics — Ambient Awareness

| Event | Feedback |
|-------|----------|
| Agent needs approval | 3 short pulses |
| Task completed | 1 long pulse |
| Error occurred | Rapid vibration |

*Feel when something needs attention—even when you're not looking.*

---

## Architecture

AgentDeck uses a Bridge architecture that separates concerns and enables multi-source support:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│   ┌─────────────┐      ┌─────────────┐      ┌─────────────┐     │
│   │    tmux     │      │   VS Code   │      │   Cursor    │     │
│   │  terminals  │      │  terminals  │      │  terminals  │     │
│   └──────┬──────┘      └──────┬──────┘      └──────┬──────┘     │
│          │                    │                    │             │
│          └────────────────────┼────────────────────┘             │
│                               ▼                                  │
│                 ┌─────────────────────────┐                      │
│                 │     Bridge Service      │  Node.js             │
│                 │  • Terminal monitoring  │                      │
│                 │  • Claude Code parsing  │                      │
│                 │  • State management     │                      │
│                 └───────────┬─────────────┘                      │
│                             │ WebSocket                          │
│                             ▼                                    │
│                 ┌─────────────────────────┐                      │
│                 │      Logi Plugin        │  C# / Actions SDK    │
│                 │  • LCD rendering        │                      │
│                 │  • Ring content         │                      │
│                 │  • Haptic feedback      │                      │
│                 └───────────┬─────────────┘                      │
│                             │                                    │
└─────────────────────────────┼────────────────────────────────────┘
                              ▼
                   MX Creative Console
                      + MX Master 4
```

---

## Quick Start

### Prerequisites

- macOS or Windows
- [Logi Options+](https://www.logitech.com/software/logi-options-plus.html) installed
- Logitech MX Creative Console
- Node.js 18+ (for Bridge service)
- tmux installed (`brew install tmux` on macOS) — *or VS Code/Cursor*
- Claude Code CLI installed

### Installation (5 minutes)

**Option 1: tmux Users (Recommended)**

```bash
# 1. Install the Logi plugin
# Download AgentDeck.lplug4 from Releases
# Double-click to install in Logi Options+
# (Bridge starts automatically with plugin)

# 2. Configure your projects
mkdir -p ~/.agentdeck
cat > ~/.agentdeck/config.json << 'EOF'
{
  "projects": [
    { "name": "MyApp", "path": "~/projects/my-app" },
    { "name": "API", "path": "~/projects/api" }
  ]
}
EOF

# 3. Press NEW on the keypad and start working!
```

**Option 2: VS Code / Cursor Users**

```bash
# 1. Install the Logi plugin (same as above)

# 2. Install the VS Code extension
code --install-extension agentdeck.agentdeck

# 3. Open Claude Code in VS Code terminals
# AgentDeck automatically detects them!
```

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

## Quick Reference

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENTDECK QUICK REFERENCE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  KEYPAD                                                         │
│  ───────                                                        │
│  Tap agent      → Open Ring with details                        │
│  Hold agent     → Open terminal directly                        │
│  NEW            → Launch new Claude agent                       │
│  STATUS         → See all agents + costs                        │
│  CUSTOM         → Your configured action                        │
│                                                                  │
│  DIALPAD (when Ring is open)                                    │
│  ───────────────────────────                                    │
│  Dial           → Scroll content                                │
│  Roller         → Navigate files                                │
│  YES            → Approve / Select / Confirm                    │
│  NO             → Reject / Cancel / Close                       │
│  UNDO           → Revert last change                            │
│  PAUSE          → Pause agent                                   │
│                                                                  │
│  COLORS                                                         │
│  ───────                                                        │
│  🟢 Green       → Idle, ready                                   │
│  🟡 Yellow      → Working                                       │
│  🔴 Red         → Needs approval (+ haptic)                     │
│  ⚫ Gray        → Empty / Offline                               │
│                                                                  │
│  HAPTICS (MX Master 4)                                          │
│  ─────────────────────                                          │
│  3 short pulses → Approval needed                               │
│  1 long pulse   → Task completed                                │
│  Rapid pulses   → Error occurred                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

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
