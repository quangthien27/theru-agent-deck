# AgentDeck

**Command your AI fleet.**

AgentDeck turns the Logitech MX Creative Console into mission control for AI coding agents — Claude Code, Gemini CLI, Codex, Aider, and OpenCode. Glance at the LCD to see which agent needs attention, approve or reject with a tap, and launch new sessions without leaving your editor.

---

## Why

Developers run multiple AI agents in parallel, but they live in terminals with zero visual feedback. You tab-switch to check progress, scroll to find missed approvals, and lose track of which agent needs you. AgentDeck gives your fleet a physical control surface.

---

## How It Works

```
  VS Code  ─── :9999  ──┐
  Windsurf ─── :10000 ──┼──▶  Logi Plugin ──▶  MX Creative Console
  Cursor   ─── :10001 ──┘                       + MX Master 4

  Multiple windows. One control surface.
```

Each editor window runs an extension on its own WebSocket port (`:9999`–`:10008`). The Logi plugin connects to all windows, merges agent lists, and routes commands back to the right one. No tmux, no bridge process — the extension IS the server.

---

## Features

### LCD Dashboard

The Dynamic Folder takes over all 9 LCD buttons:

```
┌───────────┬───────────┬───────────┐
│   EXIT    │    +      │  4 ●◐✕    │  Row 1: controls
│           │   NEW     │ SESSIONS  │
├───────────┼───────────┼───────────┤
│ 🟢 PREP   │ 🟡 API    │ 🔴 SNAP   │  Up to 6 agent tiles
│ idle      │ working   │ INPUT!    │  Color-coded by status
├───────────┼───────────┼───────────┤
│ 🟢 DOCS   │           │           │
│ idle      │           │           │
└───────────┴───────────┴───────────┘
```

- **Tile 1 (EXIT)** → closes the Dynamic Folder
- **Tile 2 (NEW)** → agent type picker with optional `git worktree` isolation
- **Tile 3 (SESSIONS)** → live count + status dots across all windows
- **Tiles 4–9** → up to 6 agent tiles, color-coded by status
- **Single tap** any agent tile → editor window foregrounds, terminal focuses
- **Double tap** any agent tile → skills page (Commit, Restart, Checkpoint, Diff, Continue, Mode, End)
- Dial rotates to scroll when you have more than 6 agents

### Dial — Diff Scrubbing

Rotate to cycle through changed files; press to toggle between file and hunk mode. Backed by VS Code's Git API (`git.openChange`, `workbench.action.editor.nextChange`). With worktrees, each agent's scrubbing is scoped to its own changes.

### MX Master 4 — Haptic Feedback

| Event | Pattern |
|---|---|
| Agent needs input | `sharp_collision` |
| Agent completed | `completed` |
| Agent error | `angry_alert` |

Feel when something needs attention — no screen required.

### 4-Layer Status Detection

| Layer | Mechanism | Latency |
|---|---|---|
| 1. Escape sequences | BEL (`\x07`), OSC 9/777 | Instant |
| 2. Heuristic patterns | Agent-specific prompts/spinners | 2s poll |
| 3. Silence detection | Sustained PTY quiet = done | 2–10s |
| 4. AI classifier (optional) | Local Ollama fallback | Async |

Claude Code's BEL fires the instant it needs approval. When a streaming agent goes silent for 2–10s, it's idle.

### Auto-Attach

Type `claude`, `gemini`, `aider`, `codex`, or `opencode` in any terminal — AgentDeck detects it via VS Code's Shell Integration API and attaches automatically. No launcher wrapper required.

### Multi-Window & Worktrees

- **Multi-window**: each editor window gets its own port; agent IDs are prefixed (`w9999-agent-1`). Tapping a tile foregrounds the correct window; NEW launches into the last-focused one.
- **Worktrees**: toggle on the NEW grid. Each agent gets its own branch and working directory (e.g. `agentdeck/claude-myproject-a1b2`), sharing the same `.git` object database.

---

## Setup

### Prerequisites

- macOS (Windows & Linux planned)
- [Logi Options+](https://www.logitech.com/software/logi-options-plus.html)
- Logitech MX Creative Console (MX Master 4 optional, adds haptics)
- VS Code, Windsurf, or Cursor
- At least one agent CLI on your `PATH`: `claude`, `gemini`, `codex`, `aider`, or `opencode`

### 1. Install the Logi Plugin

1. Download `AgentDeck-<version>.lplug4` from [Releases](https://github.com/quangthien27/theru-agent-deck/releases), or build from source (see Development).
2. Double-click the `.lplug4` file — Logi Options+ installs it automatically.
3. Open **Logi Options+** → select your MX Creative Console.
4. Drag the **Agent Deck** Dynamic Folder onto any LCD button.
5. (Optional) Assign standalone actions to other keys or the MX Master 4 Actions Ring:
   - **Quick Launch**, **Approve All**, **Next Waiting**, **Cycle Agent**
   - Dial: **Agent Selector**, **Effort Level**, **Permission Mode**

If the plugin doesn't appear, restart the Logi Plugin Service:

```bash
pkill -f LogiPluginService
open /Applications/Utilities/LogiPluginService.app
```

### 2. Install the VS Code Extension

1. Download `agentdeck-<version>.vsix` from [Releases](https://github.com/quangthien27/theru-agent-deck/releases), or build from source.
2. In VS Code / Windsurf / Cursor: **Extensions panel → ⋯ → Install from VSIX…** and select the file.
3. Reload the window when prompted.
4. (Optional) Open **Settings** and tune:

| Setting | Default | Description |
|---|---|---|
| `agentdeck.autoAttach` | `true` | Detect agents launched manually in any terminal |
| `agentdeck.worktree.enabled` | `true` | Launch each agent in its own `git worktree` |
| `agentdeck.ai.enabled` | `false` | Enable optional Ollama status classifier |
| `agentdeck.ai.ollamaUrl` | `http://localhost:11434` | Ollama server URL |
| `agentdeck.ai.model` | `qwen2.5:0.5b` | Model used for classification |

### 3. Try It

1. Open a project in your editor.
2. Tap the LCD button you assigned Agent Deck to.
3. Tap **NEW** → pick an agent type (e.g. Claude) → a new terminal spawns with the agent running.
4. The tile turns green while the agent works, yellow when it needs you, red on error.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  VS Code / Windsurf / Cursor (per window)                    │
│  • Spawns agents via node-pty + Pseudoterminal (stable API)  │
│  • 4-layer status detection                                  │
│  • WebSocket server on :9999–10008 (one port per window)     │
│  • Auto-attach, sidebar, diff viewer, command palette        │
└──────────────────────────┬───────────────────────────────────┘
                           │ WebSocket
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Logi Plugin (C# / Actions SDK)                              │
│  • BridgeMultiClient: connects to ALL windows in parallel    │
│  • Merges agent state into unified dashboard                 │
│  • Routes commands to correct window by agent ID prefix      │
│  • Dynamic Folder: dashboard / skills / new-agent views      │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
                  MX Creative Console + MX Master 4
```

Agents run as native editor terminals via `node-pty` and the stable `vscode.Pseudoterminal` API. Input (`approve`/`reject`) writes straight to the PTY; output feeds the status parser. Sessions don't persist across editor restarts — acceptable because the console user always has the editor open.

---

## Supported Agents

| Agent | Detection | Notes |
|---|---|---|
| Claude Code | BEL + spinner + silence (2s) | Best supported — instant BEL |
| Gemini CLI | Heuristic + silence (5s) | TUI-based |
| OpenCode | Heuristic + silence (5s) | TUI-based |
| Codex | Heuristic + silence (5s) | TUI-based |
| Aider | Heuristic + silence (10s) | Longer model-inference pauses |
| Generic | Y/N prompts + silence (10s) | Any CLI with confirmations |

Status maps to the same four states across every agent: `idle` (gray), `working` (green), `waiting` (yellow pulsing), `error` (red pulsing).

---

## Development

### Build from Source

```bash
# VS Code Extension
npm run ext:install
npm run ext:compile
npm run ext:watch        # hot reload; F5 launches Extension Dev Host

# Logi Plugin (requires dotnet 8)
cd packages/logi-plugin/src
dotnet build -c Debug

# Simulator (hardware-free testing)
cd packages/simulator
bun dev                  # http://localhost:8888
```

### Release Build

```bash
npm run release          # → releases/v{version}-{timestamp}-{commit}/
```

Produces both `AgentDeck-<version>.lplug4` and `agentdeck-<version>.vsix`.

### Project Structure

```
agentdeck/
├── packages/
│   ├── logi-plugin/src/       # C# — Folders, Commands, Adjustments, Services
│   ├── vscode-extension/src/  # TS — extension, agent-pty, status-parser, ws-server
│   └── simulator/             # Web-based console simulator
├── scripts/release.sh
└── CLAUDE.md                  # Full architecture documentation
```

---

## Platform Support

| Platform | Status | Notes |
|---|---|---|
| macOS | Supported | Window focus via `osascript` + bundle ID |
| Windows | Planned | Plugin is cross-platform; needs PowerShell focus |
| Linux | Planned | Awaiting Logi Options+ for Linux |

---

## Acknowledgments

- Built for [DevStudio 2026 by Logitech](https://devstudiologitech2026.devpost.com/)
- Powered by the [Logi Actions SDK](https://logitech.github.io/actions-sdk-docs/)
- Designed around [Claude Code](https://www.anthropic.com/claude-code)

---

<p align="center"><strong>AgentDeck</strong> — Command your AI fleet.</p>
