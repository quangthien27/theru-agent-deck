# CLAUDE.md - AgentDeck Project Guide

## Project Overview

AgentDeck gives developers a physical control surface for managing multiple AI coding agents. Glance at your MX Creative Console to see which agents need attention, approve or reject with one tap, and launch new sessions — all without leaving your editor.

It combines two components:

1. **Logi Plugin** (C#) — MX Creative Console + MX Master 4 integration (status tiles, quick actions, haptics)
2. **VS Code Extension** (TypeScript) — The brain: manages agent processes, terminals, diffs, sidebar, and runs a WebSocket server for the Logi Plugin

No external dependencies — no tmux, no Agent Deck binary, no Bridge process. The VS Code Extension spawns agents as native VS Code terminals and serves everything.

## Architecture

```
            MX Creative Console              VS Code / Cursor
            + MX Master 4                    (IDE)
                 │                                │
                 │                                │
      ┌──────────┴──────────┐          ┌──────────┴──────────────────┐
      │  Logi Plugin (C#)   │          │  VS Code Extension (TS)     │
      │                     │          │                              │
      │  • Dynamic Folder:  │          │  • Agent Manager:            │
      │    agent status     │          │    spawn/kill agent processes│
      │    tiles on LCD     │          │    in VS Code terminals      │
      │  • Quick actions:   │          │  • Status Detection:         │
      │    approve/reject   │          │    parse terminal output     │
      │  • Actions Ring:    │          │    (running/waiting/idle/err)│
      │    8 shortcuts      │          │  • Sidebar: agent list       │
      │  • Haptics on       │          │  • Diff viewer for approvals │
      │    MX Master 4      │          │  • WebSocket server (:9999)  │
      │                     │          │    serves Logi Plugin +      │
      │  Tap agent tile →   │          │    simulator                 │
      │  VS Code focuses    │          │                              │
      │  that terminal      │          │                              │
      └──────────┬──────────┘          └──────────────────────────────┘
                 │ WebSocket :9999                │
                 │                                │
                 └────────────────────────────────┘
                    Extension IS the server
```

### Why No Bridge / Agent Deck / tmux?

| Need | VS Code Extension handles it |
|---|---|
| Spawn agents | `vscode.window.createTerminal({ shellPath: 'claude' })` |
| Send input (approve/reject) | `terminal.sendText('y')` |
| Read terminal output | `Pseudoterminal` API — intercept all output |
| Status detection | Parse output patterns (same logic Agent Deck used) |
| Multi-agent support | Multiple VS Code terminals, tracked in state |
| Serve Logi Plugin | Built-in WebSocket server on `:9999` |
| Show diffs | Native `vscode.diff` command |
| Git worktree | `git worktree add` via child_process |

**Trade-off**: Sessions don't persist if VS Code closes. Acceptable because the console user always has VS Code open.

### Role Split: Console vs Editor

| Concern | MX Creative Console (Logi Plugin) | VS Code Extension |
|---|---|---|
| **What it's good at** | Glanceable status, quick actions without context-switching | Rich content, terminal access, full diffs |
| Agent status | Color-coded 80x80 LCD tiles (green/yellow/red/gray) | Sidebar list with status icons |
| Approve/reject | Tap waiting tile → YES/NO in bottom row | Click in sidebar or terminal |
| View terminal | Tap tile → VS Code focuses that terminal | Full integrated terminal |
| Launch agent | NEW button → pick agent type | Command palette or sidebar button |
| Haptics | MX Master 4 vibrates on status change | N/A |
| Works without screen | Yes — ambient awareness via hardware | No |

The console is the **remote control**. VS Code is the **screen**.

## Platform Support

| Platform | Status | Notes |
|---|---|---|
| **macOS** | v1.0 | Full support. |
| **Windows** | Future | Plugin itself is cross-platform. |
| **Linux** | Future | Needs Logi Options+ for Linux. |

## Agent Status Mapping

The extension detects these statuses by parsing terminal output. UI maps them consistently:

| Status | Symbol | Color | Console Tile | Meaning |
|---|---|---|---|---|
| `running` | `●` | Green | Green tile, "running" | Agent actively working |
| `waiting` | `◐` | Yellow | Yellow tile (pulsing), "INPUT!" | Needs user input/approval |
| `idle` | `○` | Gray | Gray tile, "ready" | Ready for commands |
| `error` | `✕` | Red | Red tile (pulsing), "error" | Something went wrong |

### Status Detection Patterns

The extension parses terminal output to detect status. Patterns per agent type:

| Agent | Waiting signal | Idle signal | Error signal |
|---|---|---|---|
| Claude Code | `Do you want to proceed?`, `Allow`, `Yes/No` | `$` prompt after completion | `Error:`, stack traces |
| Gemini CLI | `Confirm?`, `[Y/n]` | Prompt idle | Error output |
| Aider | `/run`, `y/n` prompts | `aider>` prompt | Error messages |
| Generic | `[y/N]`, `[Y/n]`, `approve` | Shell prompt | `error`, `Error`, `ERROR` |

## VS Code Extension Architecture

The extension is the central hub — it manages agents, serves the Logi Plugin, and provides all UI.

### Core Modules

| Module | Purpose |
|---|---|
| `extension.ts` | Activation, lifecycle, wires everything together |
| `agent-manager.ts` | Spawn/kill agent processes via VS Code terminals |
| `status-parser.ts` | Parse terminal output to detect agent status |
| `ws-server.ts` | WebSocket server on `:9999` for Logi Plugin + simulator |
| `sidebar-provider.ts` | TreeDataProvider for agent list in sidebar |
| `terminal-manager.ts` | Creates and tracks VS Code terminal instances |
| `diff-viewer.ts` | Opens native diff editor for approval review |
| `commands.ts` | Command palette: approve, reject, new agent, kill |

### Agent Lifecycle

```
1. User triggers "New Agent" (console NEW button or command palette)
2. Extension receives agent type + project path
3. Extension spawns: vscode.window.createTerminal({
     name: 'AgentDeck: claude',
     shellPath: 'claude',
     shellArgs: ['-m', 'user message'],
     cwd: '/path/to/project'
   })
4. Extension wraps terminal with Pseudoterminal to intercept output
5. Status parser monitors output → updates agent state
6. State broadcast to Logi Plugin via WebSocket
7. Logi Plugin updates LCD tiles
8. When agent needs approval → tile turns yellow, haptic buzz
9. User taps YES on console → extension sends 'y' to terminal
10. Agent continues → tile turns green
```

### Terminal I/O via Pseudoterminal

The extension uses VS Code's `Pseudoterminal` API to intercept all terminal output:

```typescript
const pty: vscode.Pseudoterminal = {
  onDidWrite: writeEmitter.event,  // Output to VS Code terminal UI
  open: () => { /* spawn child process */ },
  close: () => { /* kill process */ },
  handleInput: (data) => { /* forward to child process stdin */ },
};

// All output passes through → we can parse for status patterns
childProcess.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  statusParser.feed(agentId, text);  // Parse for status
  writeEmitter.fire(text);           // Forward to terminal UI
});
```

### Features

1. **Sidebar: Agent List** — TreeView showing all agents with live status icons
2. **Integrated Terminal** — Each agent runs in a VS Code terminal with full I/O
3. **Diff Viewer** — When agent is waiting, shows pending changes via `vscode.diff`
4. **Commands** — Approve, reject, pause, kill, new agent (command palette + sidebar buttons)
5. **WebSocket Server** — Serves Logi Plugin and simulator on `:9999`
6. **Logi Plugin Integration** — Receives commands, sends state updates and focus requests

## Logi Plugin Architecture

### SDK Concepts

- **Users assign individual actions** to buttons/dials via Logi Options+ UI (like Photoshop actions)
- **Actions Ring** = 8 action button slots with icon + label. **NOT a rich content overlay**. Cannot display diffs, scrollable text, or custom UI.
- **Dynamic Folders** = the key feature. A `PluginDynamicFolder` takes over all 9 LCD buttons when opened. Full control of rendering, input, and navigation.
- **Default Profiles** = shipped `.lp5` files that pre-assign our folder to a button on install.

### Dynamic Folder Approach

The user assigns one "AgentDeck" Dynamic Folder action to an LCD button. Tapping it opens the folder and takes over all 9 buttons.

**Design principle**: The 80x80px LCD tiles are too small to display file names, diffs, or code context meaningfully. The console is a **remote control** — it shows glanceable status and provides quick actions. All review happens in VS Code.

```
Dashboard (always the same layout):
┌─────────┬─────────┬─────────┐
│ JW  ●   │ AFH ◐   │ SNAP ✕  │  Agent tiles 1-6
│ running │ INPUT!  │ error   │  Color-coded status
├─────────┼─────────┼─────────┤  Tap any tile → focus terminal in VS Code
│ API ○   │  --     │  --     │
│ ready   │ (empty) │ (empty) │
├─────────┼─────────┼─────────┤
│   +     │  4 ●    │  CFG    │  Controls
│  NEW    │ STATUS  │         │
└─────────┴─────────┴─────────┘
Dial: scroll if >6 agents

Tap waiting agent (◐) → navigates into approval page:

┌─────────┬─────────┬─────────┐
│  AFH ◐  │ claude  │ ~/afh   │  Context (agent info)
│ waiting │         │         │
├─────────┼─────────┼─────────┤
│         │         │         │  (reserved for future use)
│         │         │         │
├─────────┼─────────┼─────────┤
│ APPROVE │ REJECT  │  BACK   │  Actions
│    ✓    │    ✗    │         │
└─────────┴─────────┴─────────┘
User reads terminal in VS Code, then taps APPROVE or REJECT
```

**Key behaviors:**
- **Tap non-waiting tile** → VS Code focuses that agent's terminal. Dashboard stays.
- **Tap waiting tile** → VS Code focuses terminal + navigates into approval page.
- **APPROVE** → sends approve, returns to dashboard.
- **REJECT** → sends reject, returns to dashboard.
- **BACK** → cancels, returns to dashboard.
- **No file details on LCD** — all code review happens on the monitor.

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

## WebSocket Protocol (Extension ↔ Logi Plugin)

The VS Code Extension runs a WebSocket server on `:9999`. The Logi Plugin and simulator connect as clients.

### Extension → Client

```typescript
interface StateUpdate {
  type: 'state';
  agents: AgentSession[];
}

interface AgentSession {
  id: string;
  slot: number;
  name: string;
  agent: string;       // 'claude' | 'gemini' | 'aider' | 'codex' | 'opencode'
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

### Client → Extension

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
│   │       │   └── BridgeClient.cs            # WS client → Extension :9999
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
│   │       ├── extension.ts          # Activation, lifecycle
│   │       ├── agent-manager.ts      # Spawn/kill agents in VS Code terminals
│   │       ├── status-parser.ts      # Parse terminal output for status
│   │       ├── ws-server.ts          # WebSocket server :9999
│   │       ├── sidebar-provider.ts   # TreeDataProvider for agent list
│   │       ├── terminal-manager.ts   # VS Code terminal instances
│   │       ├── diff-viewer.ts        # Native diff editor for approvals
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
    ├── MX Master 4 haptic buzz alerts user
    │   └── User glances at console, sees which agent needs them
    │
    ├── Tap yellow tile on console
    │   ├── VS Code focuses that agent's terminal (user reads context)
    │   └── Console navigates into approval page (APPROVE / REJECT / BACK)
    │
    ├── User reads terminal on monitor, decides
    │   ├── Taps APPROVE → Extension sends 'y' to terminal → agent continues → tile turns green
    │   └── Taps REJECT → Extension sends 'n' to terminal → agent receives rejection
    │
    └── Tap non-waiting tile
        └── VS Code focuses that terminal (no approve/reject needed)
```

## Development Commands

### VS Code Extension

```bash
cd packages/vscode-extension
npm install
npm run compile      # Build extension
npm run watch        # Watch mode
# F5 in VS Code → launches Extension Development Host
```

### Logi Plugin

```bash
cd packages/logi-plugin
dotnet build         # Build plugin DLL
dotnet test          # Run tests
# logiplugintool pack → produces .lplug4
```

### Simulator

```bash
cd packages/simulator
bun dev              # http://localhost:8888
```

## Build Phase Deliverables

### Required
- [ ] VS Code Extension: Agent manager (spawn/kill via terminals)
- [ ] VS Code Extension: Status parser (terminal output → status)
- [ ] VS Code Extension: WebSocket server (:9999)
- [ ] VS Code Extension: Sidebar agent list with live status
- [ ] VS Code Extension: Integrated terminal per agent
- [ ] VS Code Extension: Diff viewer for approvals
- [ ] VS Code Extension: Commands (approve, reject, new, kill)
- [ ] VS Code Extension: Responds to FocusAgent from Logi plugin
- [ ] Logi Plugin: Dynamic Folder with agent status tiles
- [ ] Logi Plugin: Approve/reject flow via folder buttons
- [ ] Logi Plugin: NEW agent flow (agent type → project picker)
- [ ] Logi Plugin: Actions Ring commands (8 quick actions)
- [ ] Logi Plugin: Haptic notifications on MX Master 4
- [ ] Logi Plugin: Default profile (pre-assigns folder to button)
- [x] Simulator: Web-based console testing

### Nice to Have
- [ ] Cost tracking display
- [ ] Git worktree display
- [ ] Session forking
- [ ] Windows support

### Deliverables
- [ ] 3-minute demo video
- [ ] Public GitHub repository
- [ ] Release: .lplug4 + .vsix

## Resources

- [Logi Actions SDK Documentation](https://logitech.github.io/actions-sdk-docs/)
- [Actions SDK C# Plugin Development](https://logitech.github.io/actions-sdk-docs/csharp/plugin-development/introduction/)
- [Actions SDK Plugin Features](https://logitech.github.io/actions-sdk-docs/csharp/plugin-features/)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [VS Code Pseudoterminal API](https://code.visualstudio.com/api/references/vscode-api#Pseudoterminal)
