# CLAUDE.md - AgentDeck Project Guide

## Project Overview

AgentDeck gives developers a physical control surface for managing multiple AI coding agents. Glance at your MX Creative Console to see which agents need attention, approve or reject with one tap, and launch new sessions — all without leaving your editor.

It combines four components:

1. **Agent Deck** (Go binary) — Open-source session manager for AI coding agents (tmux-based)
2. **Bridge Service** (compiled TypeScript binary) — Shared backend connecting all clients to Agent Deck
3. **Logi Plugin** (C#) — MX Creative Console + MX Master 4 integration (status tiles, quick actions, haptics)
4. **VS Code Extension** (TypeScript) — Terminal integration, diff viewer, sidebar agent list

## Architecture

```
                MX Creative Console              VS Code / Cursor
                + MX Master 4                    (IDE)
                     │                                │
                     │                                │
          ┌──────────┴──────────┐          ┌──────────┴──────────┐
          │  Logi Plugin (C#)   │          │  VS Code Extension  │
          │                     │          │  (TypeScript)        │
          │  • Dynamic Folder:  │          │                     │
          │    agent status     │          │  • Sidebar: agent   │
          │    tiles on LCD     │          │    list + status    │
          │  • Quick actions:   │          │  • Integrated       │
          │    approve/reject   │          │    terminal per     │
          │  • Actions Ring:    │          │    agent session    │
          │    8 shortcuts      │          │  • Diff viewer for  │
          │  • Haptics on       │          │    approvals        │
          │    MX Master 4      │          │  • Commands for     │
          │                     │          │    Logi plugin to   │
          │  Tap agent tile →   │          │    trigger          │
          │  VS Code focuses    │          │                     │
          │  that terminal      │          │                     │
          └──────────┬──────────┘          └──────────┬──────────┘
                     │ WebSocket :9999                │ WebSocket :9999
                     │                                │
                     └────────────┬───────────────────┘
                                  │
                     ┌────────────┴────────────┐
                     │  Bridge (compiled bin)   │
                     │                          │
                     │  • SSE client → AD       │
                     │  • WS client pool → AD   │
                     │  • CLI executor → AD     │
                     │  • State mapper          │
                     │  • WS server :9999       │
                     │    (multiple clients)    │
                     └────────────┬─────────────┘
                                  │
                     ┌────────────┴────────────┐
                     │  Agent Deck (Go binary)  │
                     │  REST + SSE + WS :8420   │
                     │                          │
                     │  • tmux session mgmt     │
                     │  • Status detection      │
                     │  • Multi-agent support   │
                     └──────────────────────────┘
```

### Role Split: Console vs Editor

| Concern | MX Creative Console (Logi Plugin) | VS Code Extension |
|---|---|---|
| **What it's good at** | Glanceable status, quick actions without context-switching | Rich content, terminal access, full diffs |
| Agent status | Color-coded 80x80 LCD tiles (green/yellow/red/gray) | Sidebar list with status icons |
| Approve/reject | One tap on console | Click in sidebar or terminal |
| View diff/terminal | Tap tile → triggers VS Code to show it | Full integrated terminal + diff viewer |
| Launch agent | NEW button → pick agent type → pick project | Command palette or sidebar button |
| Haptics | MX Master 4 vibrates on status change | N/A |
| Works without screen | Yes — ambient awareness via hardware | No |

The console is the **remote control**. VS Code is the **screen**.

## Platform Support

| Platform | Status | Notes |
|---|---|---|
| **macOS** | v1.0 | Full support. Requires tmux (guided install on first run). |
| **Windows** | Future | Requires WSL2 + tmux. Plugin itself is cross-platform. |
| **Linux** | Future | Needs Logi Options+ for Linux. |

## Why Agent Deck as Backend

Instead of building our own terminal monitoring, we use [Agent Deck](https://github.com/asheshgoplani/agent-deck):

| Need | Agent Deck provides |
|---|---|
| Terminal monitoring | tmux integration with status detection |
| Session management | Create, fork, kill, group sessions |
| Multi-agent support | Claude Code, Gemini, OpenCode, Codex, Aider |
| Status tracking | running / waiting / idle / error |
| Git isolation | Worktree support per agent |
| Real-time updates | REST API + SSE + WebSocket on `:8420` |

## Agent Deck Status Mapping

Agent Deck detects these statuses. Our UI maps them consistently:

| Agent Deck Status | Symbol | Color | Console Tile | Meaning |
|---|---|---|---|---|
| `running` | `●` | Green | Green tile, "running" | Agent actively working |
| `waiting` | `◐` | Yellow | Yellow tile (pulsing), "INPUT!" | Needs user input/approval |
| `idle` | `○` | Gray | Gray tile, "ready" | Ready for commands |
| `error` | `✕` | Red | Red tile (pulsing), "error" | Something went wrong |

## Logi Plugin Architecture

### SDK Concepts (corrected understanding)

The Logi Actions SDK works differently from what we initially assumed:

- **Users assign individual actions** to buttons/dials via Logi Options+ UI (like Photoshop actions)
- **Actions Ring** = 8 action button slots with icon + label. **NOT a rich content overlay**. Cannot display diffs, scrollable text, or custom UI.
- **Dynamic Folders** = the key feature. A `PluginDynamicFolder` takes over all 9 LCD buttons when opened. Full control of rendering, input, and navigation.
- **Default Profiles** = shipped `.lp5` files that pre-assign our folder to a button on install.

### Dynamic Folder Approach

The user assigns one "AgentDeck" Dynamic Folder action to an LCD button. Tapping it opens the folder and takes over all 9 buttons:

```
Page 1: Agent Dashboard
┌─────────┬─────────┬─────────┐
│ JW  ●   │ AFH ◐   │ SNAP ✕  │  Agent tiles 1-6
│ running │ INPUT!  │ error   │  Color-coded status
├─────────┼─────────┼─────────┤  Tap = show in VS Code
│ API ○   │  --     │  --     │  Long-press = open terminal
│ ready   │ (empty) │ (empty) │
├─────────┼─────────┼─────────┤
│   +     │  4 ●    │  BACK   │  Controls
│  NEW    │ STATUS  │         │
└─────────┴─────────┴─────────┘
Dial: scroll if >6 agents

Tap agent with ◐ (waiting) →

Page 2: Approval Actions
┌─────────┬─────────┬─────────┐
│ AFH ◐   │ auth.ts │ mid.ts  │  Agent + affected files
│ waiting │ +2 -1   │ +2 -0   │  (file name + line count)
├─────────┼─────────┼─────────┤
│ test.ts │         │         │
│ +7 -0   │         │         │
├─────────┼─────────┼─────────┤
│  YES ✓  │  NO ✗   │  BACK   │  Approve / Reject / Back
└─────────┴─────────┴─────────┘
Dial: page through files if >5

Tap file tile → VS Code opens diff for that file
Full diff → hold agent tile → opens terminal in VS Code
```

### Actions Ring (MX Master 4)

8 quick-action shortcuts — no rich content, just buttons:

1. Approve current agent
2. Reject current agent
3. Next waiting agent
4. Pause agent
5. Kill agent
6. New agent
7. Open terminal in VS Code
8. Toggle sidebar

### Haptics (MX Master 4)

Vibration patterns on agent status transitions:

| Event | Haptic Pattern |
|---|---|
| Agent needs input | `sharp_collision` (attention) |
| Agent completed | `completed` |
| Agent error | `angry_alert` |

### Key SDK Classes Used

| Class | Purpose |
|---|---|
| `PluginDynamicFolder` | Main dashboard — takes over 9 LCD buttons |
| `BitmapBuilder` | Renders 80x80 pixel tiles (text + colors + icons) |
| `PluginDynamicCommand` | Individual actions (for Actions Ring + standalone buttons) |
| `PluginDynamicAdjustment` | Dial rotation handler |

## VS Code Extension Architecture

The extension connects to the same Bridge WebSocket (:9999) as the Logi plugin.

### Features

1. **Sidebar: Agent List** — TreeView showing all agents with live status icons
2. **Integrated Terminal** — Opens VS Code terminal connected to agent's tmux session via Agent Deck WebSocket (`/ws/session/<id>`)
3. **Diff Viewer** — When agent is waiting, shows pending changes in VS Code's native diff editor
4. **Commands** — Approve, reject, pause, kill, new agent (command palette + sidebar buttons)
5. **Logi Plugin Integration** — When Logi plugin sends `open_terminal` or `show_diff`, VS Code extension receives it via bridge and focuses the right panel

### Extension ↔ Bridge Protocol

Same WebSocket protocol as Logi plugin on `:9999`. The bridge broadcasts state to all connected clients (Logi plugin + VS Code extension + simulator).

Additional VS Code-specific messages:

```typescript
// Bridge → VS Code: focus request from Logi plugin tap
interface FocusAgent {
  type: 'focus';
  agentId: string;
  view: 'terminal' | 'diff' | 'sidebar';
}
```

### Terminal Integration

The VS Code extension creates terminal instances that connect to Agent Deck's WebSocket terminal bridge:

```
VS Code Terminal → Extension → WS /ws/session/<id> → Agent Deck → tmux session
```

This lets users see full agent output, interact with approval prompts, and view real-time progress — all within VS Code.

## Agent Deck API

### REST

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/healthz` | Health check |
| `GET` | `/api/menu` | All sessions + groups |
| `GET` | `/api/session/<id>` | Single session details |

### SSE

| Endpoint | Purpose |
|---|---|
| `GET /events/menu` | Stream session state changes (pushes on change, keepalive every 15s) |

### WebSocket

| Endpoint | Purpose |
|---|---|
| `WS /ws/session/<id>` | Bidirectional terminal I/O |

Client → Server: `{ "type": "input", "data": "y\n" }`, `{ "type": "resize", "cols": 120, "rows": 30 }`
Server → Client: Binary frames (terminal output), JSON status messages

### CLI (used by Bridge)

```bash
agent-deck launch <path> -c claude [-m "message"]  # Create + start session
agent-deck session kill <id>                        # Kill session
agent-deck session start <id>                       # Start existing session
agent-deck session fork <id>                        # Fork session
agent-deck attach <id>                              # Open terminal
```

### Data Structures

```typescript
interface MenuSnapshot {
  profile: string;
  generatedAt: string;
  totalGroups: number;
  totalSessions: number;
  items: MenuItem[];
}

interface MenuItem {
  index: number;
  type: 'group' | 'session';
  level: number;
  path: string;
  group?: MenuGroup;
  session?: MenuSession;
  isLastInGroup: boolean;
  isSubSession: boolean;
}

interface MenuSession {
  id: string;
  title: string;
  tool: string;       // 'claude', 'gemini', 'opencode', 'codex', 'shell'
  status: string;      // 'idle' | 'running' | 'waiting' | 'error'
  groupPath: string;
  projectPath: string;
  parentSessionId: string;
  order: number;
  tmuxSession: string;
  createdAt: string;
  lastAccessedAt: string;
}
```

## WebSocket Protocol (Bridge ↔ Clients)

All clients (Logi plugin, VS Code extension, simulator) use the same protocol on `:9999`.

### Bridge → Client

```typescript
interface StateUpdate {
  type: 'state';
  agents: AgentSession[];
}

interface AgentSession {
  id: string;
  slot: number;
  name: string;
  agent: string;
  status: 'idle' | 'working' | 'waiting' | 'error' | 'offline';
  projectPath: string;
  createdAt: string;
}

interface AgentEvent {
  type: 'event';
  agentId: string;
  event: 'needs_approval' | 'completed' | 'error';
}

interface FocusAgent {
  type: 'focus';
  agentId: string;
  view: 'terminal' | 'diff' | 'sidebar';
}
```

### Client → Bridge

```typescript
interface AgentCommand {
  type: 'command';
  agentId: string;
  action: 'approve' | 'reject' | 'pause' | 'resume' | 'kill';
}

interface LaunchAgent {
  type: 'launch';
  projectPath: string;
  agent: string;
  message?: string;
}

interface OpenTerminal {
  type: 'open_terminal';
  agentId: string;
}
```

## Directory Structure

```
agentdeck/
├── CLAUDE.md
├── README.md
├── packages/
│   ├── bridge/                   # Bridge Service (TypeScript → compiled binary)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── agent-deck-client.ts
│   │   │   ├── state-mapper.ts
│   │   │   ├── command-handler.ts
│   │   │   ├── approval-parser.ts
│   │   │   ├── ws-server.ts
│   │   │   ├── protocol.ts
│   │   │   └── config.ts
│   │   └── tests/
│   │
│   ├── logi-plugin/              # Logi Actions Plugin (C#)
│   │   ├── AgentDeckPlugin.sln
│   │   └── src/
│   │       ├── AgentDeckPlugin.cs
│   │       ├── AgentDeckPlugin.csproj
│   │       ├── Folders/
│   │       │   └── AgentDashboardFolder.cs    # Dynamic Folder (main UI)
│   │       ├── Commands/
│   │       │   ├── ApproveCommand.cs          # For Actions Ring
│   │       │   ├── RejectCommand.cs
│   │       │   ├── NextWaitingCommand.cs
│   │       │   ├── NewAgentCommand.cs
│   │       │   └── OpenTerminalCommand.cs
│   │       ├── Adjustments/
│   │       │   └── AgentScrollAdjustment.cs
│   │       ├── Services/
│   │       │   ├── BridgeClient.cs
│   │       │   ├── BridgeLauncher.cs
│   │       │   └── DependencyChecker.cs
│   │       ├── Models/
│   │       │   ├── AgentSession.cs
│   │       │   └── PluginState.cs
│   │       ├── Helpers/
│   │       │   ├── PluginLog.cs
│   │       │   └── PluginResources.cs
│   │       └── package/
│   │           └── metadata/
│   │               └── LoupedeckPackage.yaml
│   │
│   ├── vscode-extension/         # VS Code Extension (TypeScript)
│   │   ├── package.json          # Extension manifest + contributes
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── extension.ts          # Activation, bridge client
│   │       ├── bridge-client.ts      # WebSocket client to bridge :9999
│   │       ├── sidebar-provider.ts   # TreeDataProvider for agent list
│   │       ├── terminal-manager.ts   # Creates VS Code terminals → agent tmux
│   │       ├── diff-viewer.ts        # Opens native diff editor for approvals
│   │       └── commands.ts           # Approve, reject, new agent, etc.
│   │
│   └── simulator/                # Web Simulator (dev/testing)
│       ├── package.json
│       ├── serve.ts
│       ├── index.html
│       ├── style.css
│       └── simulator.js
│
├── scripts/
│   ├── build-all.sh
│   ├── build-bridge.sh
│   └── build-plugin.sh
│
└── .github/
    └── workflows/
        └── build.yml
```

## Console ↔ VS Code Integration Flow

```
User sees yellow pulsing tile on console (agent waiting)
    │
    ├── Tap tile on console
    │   └── Bridge sends FocusAgent { view: 'terminal' } to VS Code
    │       └── VS Code extension focuses that agent's terminal
    │
    ├── Long-press tile
    │   └── Bridge sends FocusAgent { view: 'diff' } to VS Code
    │       └── VS Code shows approval diff
    │
    ├── Press YES on dialpad (or Actions Ring approve)
    │   └── Bridge sends approve to Agent Deck
    │       └── Agent continues, tile turns green
    │
    └── MX Master 4 haptic buzz alerts user
        └── User glances at console, sees which agent needs them
```

## Development Commands

### Bridge

```bash
cd packages/bridge
bun install
bun run dev          # Hot reload, connects to Agent Deck :8420
bun run test         # Run tests
bun run compile      # Compile to standalone binary
```

### Logi Plugin

```bash
cd packages/logi-plugin
dotnet build         # Build plugin DLL
dotnet test          # Run tests
# logiplugintool pack → produces .lplug4
```

### VS Code Extension

```bash
cd packages/vscode-extension
npm install
npm run compile      # Build extension
# F5 in VS Code → launches Extension Development Host
```

### Simulator

```bash
cd packages/simulator
bun dev              # http://localhost:8888
```

## Build Phase Deliverables

### Required
- [x] Bridge Service (SSE + WS + CLI client for Agent Deck)
- [x] Bridge WebSocket server (:9999) with multi-client support
- [x] Bridge tests (unit + integration)
- [ ] Logi Plugin: Dynamic Folder with agent status tiles
- [ ] Logi Plugin: Approve/reject flow via folder buttons
- [ ] Logi Plugin: NEW agent flow (agent type → project picker)
- [ ] Logi Plugin: Actions Ring commands (8 quick actions)
- [ ] Logi Plugin: Haptic notifications on MX Master 4
- [ ] Logi Plugin: Default profile (pre-assigns folder to button)
- [ ] VS Code Extension: Sidebar agent list with live status
- [ ] VS Code Extension: Integrated terminal per agent session
- [ ] VS Code Extension: Diff viewer for approvals
- [ ] VS Code Extension: Commands (approve, reject, new, kill)
- [ ] VS Code Extension: Responds to FocusAgent from Logi plugin
- [x] Simulator: Web-based console + bridge testing

### Nice to Have
- [ ] Cost tracking display
- [ ] Git worktree display
- [ ] Session forking
- [ ] Windows support (WSL2)

### Deliverables
- [ ] 3-minute demo video
- [ ] Public GitHub repository
- [ ] Release: .lplug4 + .vsix + bridge binary

## Resources

- [Agent Deck (Backend)](https://github.com/asheshgoplani/agent-deck)
- [Logi Actions SDK Documentation](https://logitech.github.io/actions-sdk-docs/)
- [Actions SDK C# Plugin Development](https://logitech.github.io/actions-sdk-docs/csharp/plugin-development/introduction/)
- [Actions SDK Plugin Features](https://logitech.github.io/actions-sdk-docs/csharp/plugin-features/)
- [VS Code Extension API](https://code.visualstudio.com/api)
