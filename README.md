# AgentDeck

**Command your AI fleet.**

AgentDeck transforms your Logitech MX Creative Console into a mission control for AI coding agents. Monitor multiple agents across multiple editor windows, see who needs attention at a glance, and take action with physical buttons and dials — all without leaving your code.

<!-- ![AgentDeck Demo](assets/demo.gif) -->

---

## The Problem

Developers run multiple AI coding agents in parallel — one refactoring, one writing tests, one debugging. But these agents live in terminals with zero visual feedback.

You're constantly:
- Tab-switching to check "is it done yet?"
- Scrolling up to find missed approval prompts
- Losing track of which agent needs attention
- Breaking flow to manage your AI helpers

**The agents are smart. The interaction model is from 1975.**

---

## The Solution

AgentDeck provides real-time visibility and physical controls for managing AI coding agents — Claude Code, Gemini CLI, Codex, Aider, and OpenCode. No external dependencies, no tmux, no bridge process. Agents run as native terminals in VS Code, Windsurf, or Cursor. The extension IS the server.

### Works Where You Work

```
┌──────────────────────────────────────────────────────────────┐
│                                                               │
│   VS Code  ─── :9999  ──┐                                    │
│                          │                                    │
│   Windsurf ─── :10000 ──┼──▶  Logi Plugin ──▶  MX Creative  │
│                          │                       Console     │
│   Cursor ──── :10001 ──┘                                    │
│                                                               │
│   Multiple windows. One control surface.                      │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

Each editor window runs its own extension instance on a unique port (`:9999`–`:10008`). The Logi plugin discovers all active windows, merges their agent lists, and routes commands to the correct window. Focus a window, tap NEW — agent spawns there.

---

## Features

### Three Layers of Physical Interaction

AgentDeck uses every surface of the MX Creative Console — LCD keypad for visual status, dial for navigation, and MX Master 4 for ambient haptic feedback. Each layer serves a different attention level: glance, interact, or feel.

### Layer 1: LCD Dashboard — Glanceable Status

The Dynamic Folder takes over all 9 LCD buttons on the MX Creative Console:

```
Dashboard:
┌───────────┬───────────┬───────────┐
│ 🟢 PREP   │ 🟡 API    │ 🔴 SNAP   │  Agent tiles (up to 5)
│ idle      │ working   │ INPUT!    │  Color-coded by status
├───────────┼───────────┼───────────┤
│ 🟢 DOCS   │           │    +      │
│ idle      │           │   NEW     │
├───────────┼───────────┼───────────┤
│           │  4 ●◐✕    │   MENU    │
│           │ SESSIONS  │           │
└───────────┴───────────┴───────────┘
Dial: rotate to scroll if >5 agents
```

- **Single tap** any agent tile → VS Code window comes to foreground + focuses that terminal
- **Double tap** any agent tile → opens skills/management page
- **NEW** → agent type picker (Claude, Gemini, Codex, Aider, OpenCode) with worktree toggle
- **STATUS** → fleet overview with agent count and colored dots

### Skills Page — Per-Agent Management

Double-tap any agent tile to open the skills page:

```
┌───────────┬───────────┬───────────┐
│  COMMIT   │  RESTART  │   CHKPT   │  Send skill prompts
│     ✓     │     ↻     │     ◆     │  to the agent
├───────────┼───────────┼───────────┤
│   DIFF    │ CONTINUE  │   MODE    │
│    ◨      │     ▶     │    ⇆     │
├───────────┼───────────┼───────────┤
│           │    END    │   BACK    │
│           │     ✗     │     ↩     │
└───────────┴───────────┴───────────┘
```

| Tile | Action |
|------|--------|
| Commit | Send commit prompt to agent |
| Restart | Kill + relaunch (same type, same project, new worktree) |
| Checkpoint | Create git tag save point |
| Diff | Open changed files in VS Code diff viewer |
| Continue | Smart: approves when waiting (yes/no), sends "continue" when idle |
| Mode | Cycle permission mode via Shift+Tab (ask/auto/plan) |
| End | Kill the agent session |

### New Agent Flow

Tap NEW to pick from 5 supported agents plus a worktree toggle:

```
┌───────────┬───────────┬───────────┐
│  CLAUDE   │  GEMINI   │   CODEX   │
│     ◆     │    ✦      │     ⬡     │
├───────────┼───────────┼───────────┤
│   AIDER   │ OPENCODE  │ WORKTREE  │
│     ⊕     │    ◎      │  🌿 ON    │
├───────────┼───────────┼───────────┤
│           │           │   BACK    │
│           │           │     ↩     │
└───────────┴───────────┴───────────┘
```

When worktree is ON, each agent gets its own `git worktree` — isolated branch and working directory, no file conflicts between agents on the same repo.

### Layer 2: Dial — Diff Scrubbing

Use the MX Creative Console dial to physically navigate through an agent's changeset:

```
                 ╭──────────╮
  Rotate:        │   DIAL   │    Press: toggle mode
  next/prev file ╰──────────╯    (file ↔ hunk)
```

- **File mode** (default): rotate the dial to cycle through git changed files — each rotation opens the next file's diff in VS Code
- **Hunk mode** (press dial to toggle): rotate to jump between change hunks within a single file
- **LCD feedback**: current position shown on dashboard (e.g., `3/7 files`)
- **Per-agent scope**: with worktrees, each agent has its own changed files — dial shows only that agent's work

Uses VS Code's Git extension API under the hood: `git.openChange` for file diffs, `workbench.action.editor.nextChange` for hunk navigation.

### Layer 3: MX Master 4 — Haptic Feedback

The MX Master 4 vibrates on agent status transitions — ambient awareness without looking at a screen:

| Event | Haptic Pattern | When |
|-------|---------------|------|
| Agent needs input | `sharp_collision` | Any agent transitions to `waiting` |
| Agent completed | `completed` | Agent finishes work (working → idle) |
| Agent error | `angry_alert` | Any agent transitions to `error` |

*Feel when something needs attention — even when you're not looking at the console.*

### 4-Layer Status Detection

AgentDeck detects agent state through four layers, in priority order:

| Layer | Mechanism | Latency | Reliability |
|-------|-----------|---------|-------------|
| **1. Escape sequences** | BEL character (`\x07`), OSC 9/777 notifications | Instant (~0ms) | Highest — hardware-level signal |
| **2. Heuristic patterns** | Parse stripped terminal output for agent-specific prompts/spinners | 2s polling | High — tailored per agent type |
| **3. Silence detection** | Track time since last PTY data chunk; sustained quiet = done | 2–10s | High — agents stream constantly while working |
| **4. AI classifier** | Optional local Ollama model for uncertain cases | Async | Medium — fallback only |

**How it works in practice:** Claude Code sends a BEL when it needs approval — your console tile turns yellow instantly. While working, Claude streams spinner updates every ~100ms. When it finishes, the stream goes silent. AgentDeck detects the 2-second silence and transitions to idle — even when TUI buffer patterns are ambiguous.

**Silence thresholds** (per agent):

| Agent | Threshold | Why |
|-------|-----------|-----|
| Claude Code | 2s | Spinner fires every ~100ms while working |
| Gemini CLI | 5s | Similar but slightly more variable |
| OpenCode | 5s | TUI-based, similar pattern |
| Codex | 5s | Similar TUI pattern |
| Aider | 10s | Can pause during model inference |

### Auto-Attach — Zero Configuration

Type `claude`, `gemini`, `aider`, `codex`, or `opencode` in any terminal. AgentDeck detects the command via VS Code's Shell Integration API, auto-attaches the terminal, and streams output for full status detection. No special launcher needed — just use agents however you normally do.

Auto-detection works through two methods:
1. **Shell Integration API** — detects the agent command the moment you press Enter
2. **Output signature matching** — scans terminal output for agent branding (e.g., "Claude Code", "Gemini CLI", "Aider v")

### Multi-Window Support

Each editor window runs independently:

- **Port scanning**: each window gets its own WebSocket port (`:9999`–`:10008`)
- **Agent IDs**: prefixed with port (`w9999-agent-1`, `w10001-agent-2`) — globally unique
- **Window focus**: tap an agent tile → the correct editor window comes to foreground via `osascript` (macOS)
- **Launch routing**: NEW sends to the last-focused window
- **State merging**: the Logi plugin merges agent lists from all connected windows into one dashboard

### Git Worktree Isolation

When multiple agents work on the same repo, worktrees prevent file conflicts:

- Each agent gets its own working directory and branch (e.g., `agentdeck/claude-myproject-a1b2`)
- Worktrees share the same `.git` object database — lightweight, instant creation
- Toggle per-launch from the NEW agent grid
- Configurable via `agentdeck.worktree.enabled` setting

### Pseudoterminal Architecture

Agents run via `node-pty` + VS Code's stable `Pseudoterminal` API:

- Full PTY with `xterm-256color` — TUI agents (Claude Code, Gemini, OpenCode) get proper interactive mode
- Output captured at the PTY level — no proposed APIs needed, works in VS Code, Windsurf, and Cursor
- `node-pty` loaded from VS Code's bundled `node_modules.asar` — no native binary in the VSIX

### Optional AI Status Classifier

When heuristic detection is uncertain, a local Ollama model provides a second opinion. Disabled by default — zero cloud dependency, no API costs.

- **Model**: `qwen2.5:0.5b` (0.5B params, ~1GB RAM)
- **Settings**: `agentdeck.ai.enabled`, `agentdeck.ai.ollamaUrl`, `agentdeck.ai.model`
- **Safeguards**: 2s timeout, 3s per-agent debounce, silent fallback on error

---

## Agent Status Mapping

| Status | Symbol | Color | Console Tile | Meaning |
|--------|--------|-------|--------------|---------|
| `idle` | `○` | Gray | Gray tile, "ready" | Ready for commands |
| `working` | `●` | Green | Green tile, "running" | Agent actively working |
| `waiting` | `◐` | Yellow | Yellow pulsing tile, "INPUT!" | Needs user input/approval |
| `error` | `✕` | Red | Red pulsing tile, "error" | Something went wrong |

---

## Architecture

No external dependencies — no tmux, no bridge process, no daemon. The VS Code Extension IS the server.

```
┌──────────────────────────────────────────────────────────────┐
│                                                               │
│  ┌─────────────────────────────────────────────────────┐      │
│  │      VS Code / Windsurf / Cursor (per window)       │      │
│  │                                                      │      │
│  │  Extension:                                          │      │
│  │  • Spawns agents via node-pty + Pseudoterminal      │      │
│  │  • 4-layer status detection (BEL, heuristic,        │      │
│  │    silence, AI classifier)                          │      │
│  │  • WebSocket server (:9999-10008, one port/window)  │      │
│  │  • Auto-attach: detects agents in any terminal      │      │
│  │  • Sidebar, diff viewer, command palette             │      │
│  └──────────────────────┬──────────────────────────────┘      │
│                          │ WebSocket (per window)             │
│                          ▼                                    │
│  ┌─────────────────────────────────────────────────────┐      │
│  │          Logi Plugin (C# / Actions SDK)             │      │
│  │                                                      │      │
│  │  • BridgeMultiClient: connects to ALL windows       │      │
│  │  • Merges agent state into unified dashboard        │      │
│  │  • Routes commands to correct window by agent ID    │      │
│  │  • Dynamic Folder: dashboard/skills/new-agent views │      │
│  │  • Double-tap detection, view-switch cooldown       │      │
│  └──────────────────────┬──────────────────────────────┘      │
│                          │                                    │
└──────────────────────────┼────────────────────────────────────┘
                           ▼
                MX Creative Console
                   + MX Master 4
```

### Why No Bridge / tmux?

| Need | How the Extension handles it |
|------|------------------------------|
| Spawn agents | `node-pty` + `Pseudoterminal` (stable API) |
| Send input (approve/reject) | `ptyHandle.write('y')` — direct to process |
| Read terminal output | `node-pty` data stream — no proposed API needed |
| Status detection | 4 layers: BEL → heuristic → silence → AI |
| Multi-agent | Multiple VS Code terminals, tracked in state |
| Serve Logi Plugin | WebSocket server on `:9999`–`:10008` |
| Show diffs | Native `vscode.diff` command |
| Git worktree | `git worktree add` via child_process |
| Window focus | `osascript` (macOS) with bundle identifier matching |

**Trade-off**: Sessions don't persist if the editor closes. Acceptable because the console user always has the editor open.

---

## All Assignable Actions

Assign these to MX Creative Console keypad, dialpad keys, or MX Master 4 Actions Ring via Logi Options+.

### Dynamic Folder

| Action | Description |
|--------|-------------|
| **Agent Deck** | Takes over all 9 LCD buttons. Dashboard with agent tiles, skills page (double-tap), new agent picker, and menu. |

### Standalone Commands

| Action | Description |
|--------|-------------|
| **Quick Launch** | Launch agent with dropdown selector (Claude, Gemini, Codex, Aider, OpenCode) |
| **Quick Prompt** | Send a custom prompt to active agent — type your prompt in Logi Options+, tap to send |
| **Agent Status** | Fleet overview tile — agent count with colored status dots |
| **Cycle Agent** | Rotate selection to next agent + focus terminal |
| **Next Waiting** | Jump to next waiting agent (shows waiting count) |
| **Approve All** | Batch approve all waiting agents |
| **Pause All** | Pause all running agents (sends Ctrl+C) |
| **End All** | Kill all agent sessions |

### Dial / Adjustment Actions

| Action | Rotate | Press |
|--------|--------|-------|
| **Agent Selector** | Cycle through agents on dashboard | Focus selected agent's terminal |
| **Effort Level** | Cycle `/effort low/medium/high` on selected agent | Reset to medium |
| **Permission Mode** | Send Shift+Tab to cycle ask/auto/plan mode | Send one Shift+Tab |

---

## Quick Start

### Prerequisites

- macOS (Windows support planned)
- [Logi Options+](https://www.logitech.com/software/logi-options-plus.html) installed
- Logitech MX Creative Console (+ MX Master 4 for haptics)
- VS Code, Windsurf, or Cursor
- At least one AI coding agent CLI installed (`claude`, `gemini`, `codex`, `aider`, `opencode`)

### Installation

```bash
# 1. Install the Logi plugin
# Download AgentDeck-*.lplug4 from Releases → double-click to install

# 2. Install the VS Code extension
# In VS Code/Windsurf/Cursor: Extensions → ⋯ → Install from VSIX → select agentdeck-*.vsix

# 3. In Logi Options+, assign "Agent Deck" folder to an LCD button

# 4. Open a project, tap the button — you're in!
```

Agents launched from the console or command palette run as native editor terminals. Agents launched manually (`claude` in any terminal) are auto-detected and attached.

---

## User Workflows

### Start a Session

1. Open your project in VS Code/Windsurf/Cursor
2. Tap the Agent Deck button on your MX Creative Console
3. Dashboard opens — all slots empty
4. Tap **NEW** → pick agent type (e.g., Claude) → agent spawns in a new terminal
5. Agent tile turns green (working)

### Handle Approvals

1. Agent needs approval → tile turns **yellow pulsing**, MX Master 4 buzzes
2. **Single tap** the tile → editor window comes to foreground, terminal focused
3. Review the prompt in the terminal
4. Approve/reject via keyboard, or use the Approve All command

### Manage Running Agents

1. **Double tap** any agent tile → skills page opens
2. Send skills: Commit, Restart, Checkpoint, Diff, Continue, Mode
3. **End** to kill the agent
4. **Back** to return to dashboard

### Multi-Window Fleet

1. Open multiple editor windows (different projects or same project)
2. Each window gets its own port — the Logi plugin connects to all of them
3. Dashboard merges all agents from all windows
4. Tap an agent → correct window comes to foreground
5. Tap NEW → agent spawns in the last-focused window

---

## Development

### Building from Source

```bash
# VS Code Extension
npm run ext:install    # Install dependencies
npm run ext:compile    # Build extension
npm run ext:watch      # Watch mode

# Logi Plugin (requires dotnet 8)
cd packages/logi-plugin/src
dotnet build -c Debug

# Simulator (for testing without hardware)
cd packages/simulator
bun dev                # http://localhost:8888
```

### Release Build

```bash
npm run release        # Builds both packages into releases/v{version}-{timestamp}-{commit}/
```

Produces:
- `AgentDeck-{version}.lplug4` — double-click or `logiplugintool install`
- `agentdeck-{version}.vsix` — install via Extensions → Install from VSIX

### Project Structure

```
agentdeck/
├── packages/
│   ├── logi-plugin/          # Logi Actions Plugin (C#)
│   │   └── src/
│   │       ├── Folders/      # Dynamic Folder (dashboard/skills/new-agent)
│   │       ├── Commands/     # Standalone actions (QuickLaunch, CycleAgent, etc.)
│   │       ├── Adjustments/  # Dial actions (AgentSelector, Effort, Mode)
│   │       ├── Services/     # BridgeMultiClient (WebSocket to extension)
│   │       └── Helpers/      # TileRenderer, PluginResources
│   │
│   ├── vscode-extension/     # VS Code Extension (TypeScript)
│   │   └── src/
│   │       ├── extension.ts      # Activation, lifecycle, port scanning
│   │       ├── agent-manager.ts  # Spawn/kill agents, terminal I/O, silence detection
│   │       ├── agent-pty.ts      # node-pty + Pseudoterminal bridge
│   │       ├── status-parser.ts  # 4-layer status detection
│   │       ├── ai-classifier.ts  # Optional Ollama AI fallback
│   │       ├── ws-server.ts      # WebSocket server (:9999-10008)
│   │       ├── diff-viewer.ts    # Git diff viewer + dial scrubbing
│   │       └── protocol.ts       # Shared types (AgentSession, commands)
│   │
│   └── simulator/            # Web-based console simulator
│       └── index.html
│
├── scripts/
│   └── release.sh            # Build + package both components
└── CLAUDE.md                 # Full architecture documentation
```

---

## Supported Agents

| Agent | Status Detection | Notes |
|-------|-----------------|-------|
| **Claude Code** | BEL + spinner + silence (2s) + "accept edits on" | Best supported — instant BEL detection |
| **Gemini CLI** | Heuristic + silence (5s) | TUI-based, "Esc to cancel" while working |
| **OpenCode** | Heuristic + silence (5s) | TUI-based, "esc interrupt" while working |
| **Codex** | Heuristic + silence (5s) | "Esc to interrupt" + timing indicators |
| **Aider** | Heuristic + silence (10s) | `aider>` prompt detection, longer think pauses |
| **Generic** | Common Y/N prompts + silence (10s) | Any CLI tool with confirmation prompts |

---

## VS Code Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `agentdeck.autoAttach` | `true` | Auto-detect agents launched in any terminal |
| `agentdeck.worktree.enabled` | `true` | Create git worktree per agent |
| `agentdeck.ai.enabled` | `false` | Enable optional Ollama AI status classifier |
| `agentdeck.ai.ollamaUrl` | `http://localhost:11434` | Ollama server URL |
| `agentdeck.ai.model` | `qwen2.5:0.5b` | Ollama model for classification |

---

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| **macOS** | Supported | Full support including window focus via osascript |
| **Windows** | Planned | Plugin is cross-platform; needs PowerShell window focus |
| **Linux** | Planned | Needs Logi Options+ for Linux |

---

## Acknowledgments

- Built for [DevStudio 2026 by Logitech](https://devstudiologitech2026.devpost.com/)
- Powered by [Logi Actions SDK](https://logitech.github.io/actions-sdk-docs/)
- Designed for [Claude Code](https://www.anthropic.com/claude-code)

---

<p align="center">
  <strong>AgentDeck</strong> — Command your AI fleet.
</p>
