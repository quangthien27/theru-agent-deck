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
| Read terminal output | `terminalDataWriteEvent` proposed API — intercept all output |
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

### Status Detection (3-Layer)

Detection uses three layers in priority order: (1) **escape sequences** (BEL, OSC — instant), (2) **heuristic pattern matching** (2s polling), (3) **AI classifier** (optional Ollama fallback). The heuristic patterns per agent type:

| Agent | Waiting signal | Idle signal | Error signal |
|---|---|---|---|
| Claude Code | `Do you want to proceed?`, `Allow`, `Yes/No` | `$` prompt after completion | `Error:`, stack traces |
| Gemini CLI | `Confirm?`, `[Y/n]` | Prompt idle | Error output |
| Aider | `/run`, `y/n` prompts | `aider>` prompt | Error messages |
| Generic | `[y/N]`, `[Y/n]`, `approve` | Shell prompt | `error`, `Error`, `ERROR` |

### Escape Sequence Detection (Instant, No Polling)

Inspired by [Ghostty terminal](https://github.com/ghostty-org/ghostty)'s approach to terminal signals. The extension intercepts standard terminal escape sequences from the raw data stream for instant status detection — no polling interval, no TUI pattern matching needed.

| Signal | Escape Sequence | What AgentDeck does |
|---|---|---|
| **BEL** (`\x07`) | Terminal bell character | Instantly transitions agent to `waiting`. Claude Code sends BEL when it needs approval — this is the fastest, most reliable detection method. |
| **OSC 9/777** | `ESC]9;message\a` / `ESC]777;notify;title;body\a` | Desktop notification from agent. Logged for status correlation. |
| **OSC 2** | `ESC]2;title\a` | Terminal title change. Agents may encode status in the title. Logged. |
| **Clear screen** (`ESC[2J`/`ESC[3J`) | Full screen redraw | Resets the output buffer — discards stale TUI content so the heuristic parser sees fresh output only. |

**Priority**: BEL > heuristic patterns > AI classifier. BEL fires instantly (within the same data chunk), while the heuristic parser runs on a 2-second polling interval. For Claude Code, BEL alone handles most waiting-state transitions.

**Bare BEL vs OSC terminator**: BEL (`\x07`) is also used as the terminator for OSC sequences (e.g., `ESC]9;hello\x07`). The extension checks that BEL is not inside an OSC sequence before triggering the waiting transition.

### AI Status Classifier (Optional)

When heuristic pattern matching is uncertain (falls through to `currentStatus`), an optional local Ollama model provides a second opinion. Disabled by default — zero cloud dependency, no API costs.

**Flow**: `detectStatus()` returns `{ status, confidence }` (0.0–1.0). When `confidence < 0.6` and Ollama is enabled, `ai-classifier.ts` fires an async classification (non-blocking, requires ≥100 chars buffer growth since last query). If the AI disagrees, it updates the status.

**Settings** (VS Code):
- `agentdeck.ai.enabled` — `false` by default
- `agentdeck.ai.ollamaUrl` — defaults to `http://localhost:11434`
- `agentdeck.ai.model` — defaults to `qwen2.5:0.5b` (0.5B params, ~1GB RAM, fastest)

**Safeguards**: 2s timeout, 3s per-agent debounce, silent fallback on any error. Uses Node `http` module directly (no npm dependency).

## VS Code Extension Architecture

The extension is the central hub — it manages agents, serves the Logi Plugin, and provides all UI.

### Core Modules

| Module | Purpose |
|---|---|
| `extension.ts` | Activation, lifecycle, wires everything together |
| `agent-manager.ts` | Spawn/kill agent processes via VS Code terminals, terminal I/O |
| `status-parser.ts` | Parse terminal output to detect agent status (returns `DetectionResult` with confidence) |
| `ai-classifier.ts` | Optional Ollama-based AI fallback for uncertain status detection |
| `ws-server.ts` | WebSocket server on `:9999` for Logi Plugin + simulator |
| `sidebar-provider.ts` | TreeDataProvider for agent list in sidebar |
| `simulator-webview.ts` | Opens simulator as VS Code webview panel |
| `protocol.ts` | Shared TypeScript types for agent sessions, commands, events |
| `commands.ts` | Command palette: approve, reject, new agent, kill |
| `diff-viewer.ts` | Git diff viewer with dial scrubbing (nav_left/nav_right) |

### Agent Lifecycle

```
Launch flow (via command palette, sidebar, or console NEW button):
1. Extension receives agent type + project path
2. Extension spawns: vscode.window.createTerminal({
     name: 'AgentDeck: claude',
     shellPath: 'claude',
     cwd: '/path/to/project'
   })
3. terminalDataWriteEvent captures all output → status parser
4. State broadcast to Logi Plugin via WebSocket
5. Logi Plugin updates LCD tiles
6. When agent needs approval → tile turns yellow, haptic buzz
7. User taps YES on console → extension sends 'y' to terminal
8. Agent continues → tile turns green

Auto-attach flow (user launches agent manually in any terminal):
1. User opens terminal, types `claude` or `aider` etc.
2. terminalDataWriteEvent captures output from untracked terminal
3. Agent type auto-detected from output patterns (shell command + banner text)
4. Terminal promoted to managed agent (same lifecycle from step 3 above)
```

### Terminal I/O via Proposed API

The extension uses VS Code's proposed `terminalDataWriteEvent` API to intercept terminal output without custom Pseudoterminals. Agents run in native VS Code terminals:

```typescript
// Capture output from all terminals
vscode.window.onDidWriteTerminalData((e) => {
  const agentId = this.terminalToAgent.get(e.terminal);
  if (agentId) {
    agent.outputBuffer += e.data;         // Buffer for status parsing
    detectStatus(agent.outputBuffer, ...); // Parse for status
  } else {
    this.tryAutoAttach(e.terminal, e.data); // Auto-detect agent type
  }
});

// Send input (approve/reject)
terminal.sendText('y');
```

Note: `terminalDataWriteEvent` is a proposed API — requires `"enabledApiProposals": ["terminalDataWriteEvent"]` in package.json and the `.d.ts` declaration file.

### Features

1. **Sidebar: Agent List** — TreeView showing all agents with live status icons
2. **Integrated Terminal** — Each agent runs in a VS Code terminal with full I/O
3. **Diff Viewer** — Git diff integration with dial scrubbing (nav_left/nav_right to cycle changed files)
4. **Commands** — Approve, reject, kill, new agent, show terminal, attach (command palette + sidebar buttons)
5. **WebSocket Server** — Serves Logi Plugin and simulator on `:9999`
6. **Logi Plugin Integration** — Receives commands, sends state updates and focus requests
7. **Auto-Attach** — Detects manually launched agents in any terminal and promotes to managed
8. **Window Focus** — Brings correct editor window to foreground on agent tile tap (osascript on macOS, PowerShell on Windows)

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
│ JW  ●   │ AFH ◐   │ SNAP ✕  │  Agent tiles 1-5
│ running │ INPUT!  │ error   │  Color-coded status
├─────────┼─────────┼─────────┤  Single tap → focus terminal in VS Code
│ API ○   │  --     │   +     │  Double tap → skills page
│ ready   │ (empty) │  NEW    │
├─────────┼─────────┼─────────┤
│         │  4 ●◐✕  │  MENU   │  Controls
│         │ SESSIONS│         │
└─────────┴─────────┴─────────┘
Dial: scroll if >5 agents

Double-tap any agent tile → skills page:

┌─────────┬─────────┬─────────┐
│ COMMIT  │   FIX   │  TEST   │  Skill tiles — send command to agent
│    ✓    │   🔧    │   ✓     │
├─────────┼─────────┼─────────┤
│ REFACT  │ REVIEW  │  BACK   │
│   ♻️    │   👁    │         │
├─────────┼─────────┼─────────┤
│ EXPLAIN │   END   │         │  END = kill agent session
│   💡    │    ✗    │         │
└─────────┴─────────┴─────────┘
```

**Key behaviors:**
- **Single tap any tile** → VS Code focuses that agent's terminal (brings app window to foreground).
- **Double tap any tile** → Opens skills page for that agent (any status).
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
├── packages/
│   ├── logi-plugin/              # Logi Actions Plugin (C#)
│   │   ├── AgentDeckPlugin.sln
│   │   └── src/
│   │       ├── AgentDeckPlugin.cs
│   │       ├── AgentDeckPlugin.csproj
│   │       ├── Adjustments/
│   │       │   ├── DialAdjustment.cs
│   │       │   └── RollerAdjustment.cs
│   │       ├── Commands/
│   │       │   ├── AgentSlotCommand.cs        # Agent tile tap handler
│   │       │   ├── CustomCommand.cs           # Custom action button
│   │       │   ├── NewAgentCommand.cs         # NEW button
│   │       │   └── StatusCommand.cs           # Status overview tile
│   │       ├── Services/
│   │       │   ├── BridgeClient.cs            # WS client → Extension :9999
│   │       │   ├── BridgeLauncher.cs          # Starts/manages bridge connection
│   │       │   └── DependencyChecker.cs       # Verifies runtime dependencies
│   │       ├── Models/
│   │       │   ├── AgentSession.cs
│   │       │   └── PluginState.cs
│   │       └── Helpers/
│   │           ├── PluginLog.cs
│   │           └── PluginResources.cs
│   │       ├── Folders/
│   │       │   └── AgentDashboardFolder.cs  # Dynamic Folder (main UI — dashboard/skills/new-agent/menu)
│   │       # NOT YET IMPLEMENTED:
│   │       # ├── Commands/
│   │       # │   ├── ApproveCommand.cs        # For Actions Ring
│   │       # │   ├── RejectCommand.cs
│   │       # │   ├── NextWaitingCommand.cs
│   │       # │   ├── KillAgentCommand.cs
│   │       # │   └── OpenTerminalCommand.cs
│   │       # └── package/metadata/LoupedeckPackage.yaml  # Default profile
│   │
│   ├── vscode-extension/         # VS Code Extension (TypeScript)
│   │   ├── package.json          # Extension manifest + contributes
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── extension.ts          # Activation, lifecycle
│   │       ├── agent-manager.ts      # Spawn/kill agents, terminal I/O
│   │       ├── status-parser.ts      # Parse terminal output for status
│   │       ├── ai-classifier.ts      # Optional Ollama AI status classifier
│   │       ├── protocol.ts           # Shared types (AgentSession, commands, events)
│   │       ├── ws-server.ts          # WebSocket server :9999
│   │       ├── sidebar-provider.ts   # TreeDataProvider for agent list
│   │       ├── simulator-webview.ts  # Opens simulator as VS Code webview
│   │       ├── commands.ts           # Approve, reject, new agent, etc.
│   │       └── diff-viewer.ts       # Git diff viewer + dial scrubbing
│   │
│   │
│   └── simulator/                # Web Simulator (dev/testing)
│       ├── package.json
│       ├── serve.ts
│       ├── index.html
│       ├── style.css
│       ├── simulator.js
│       └── icons/
│
└── ref/                          # Reference projects for research
    ├── agent-of-empires-main/    # Hooks + worktree patterns
    └── agent-deck/               # Earlier prototype
```

## Console ↔ VS Code Integration Flow

```
User sees yellow pulsing tile on console (agent waiting)
    │
    ├── MX Master 4 haptic buzz alerts user
    │   └── User glances at console, sees which agent needs them
    │
    ├── Single tap any agent tile
    │   └── VS Code window comes to foreground + focuses that agent's terminal
    │       (uses osascript on macOS to activate correct window by workspace name)
    │
    ├── Double tap any agent tile
    │   └── Opens skills page (Commit, Fix, Test, Refactor, Review, Explain, END)
    │       Works for any agent status — user handles approval via keyboard in terminal
    │
    └── User reads terminal on monitor, interacts directly via keyboard
```

## Development Commands

### VS Code Extension

```bash
# From project root (uses root package.json scripts):
npm run ext:install   # Install dependencies
npm run ext:compile   # Build extension
npm run ext:watch     # Watch mode
npm run ext:package   # Package as .vsix
# F5 in VS Code → launches Extension Development Host
# .vscode/launch.json + tasks.json configured at project root
```

### Logi Plugin

```bash
cd packages/logi-plugin/src    # Build from src/ where .csproj lives
dotnet build -c Debug           # Build plugin DLL
# logiplugintool pack → produces .lplug4
```

**Note:** dotnet is installed via Homebrew at `/opt/homebrew/Cellar/dotnet@8/8.0.124/bin/dotnet` but not in PATH. Either add it to PATH or use the full path. The `obj/` directory at `logi-plugin/` (not `logi-plugin/src/`) can cause duplicate assembly attribute errors — delete it if that happens. Post-build auto-creates `.link` file and sends reload to Logi Plugin Service. If reload doesn't pick up changes, restart the service: `pkill -f LogiPluginService; sleep 2; open /Applications/Utilities/LogiPluginService.app` (it does NOT auto-restart).

**Logi Plugin SDK Lessons Learned:**
- A `ClientApplication` subclass is **required** even when `HasNoApplication = true` — without it the plugin fails to load with `'Loupedeck.ClientApplication' class not found`.
- `PluginDynamicFolder` with `NavigationArea.None`: the system still reserves button position 0 for Back. Use `NavigateUpActionName` as the first item in `GetButtonPressActionNames` and control positions 1-8 (8 usable buttons on MX Creative Console).
- **Image refresh**: `ButtonActionNamesChanged()` only re-renders if the action names actually change. To force full tile refresh when switching views, include a counter/epoch in the action parameter names (e.g. `{view}_{epoch}_{pos}`) so each `Refresh()` produces different names.
- `GetCommandDisplayName` must return `""` to hide the action parameter text from showing on the LCD tile.
- `Activate()`/`Deactivate()` return `Boolean` (not `void`).
- Plugin logs: `~/Library/Application Support/Logi/LogiPluginService/Logs/plugin_logs/AgentDeck.log`
- If plugin is added to disabled list after a crash, restart LogiPluginService to clear it.
- **Bitmap resolution**: MX Creative Console requests `PluginImageSize.Width116` (116x116 pixels). Use `(Int32)imageSize` to get the actual pixel value. Never hardcode 80 — renders at wrong size and gets upscaled/blurred. All embedded icon PNGs should be 116x116 to match.
- **`PluginResources.ReadImage` uses suffix matching** — `ReadImage("x.png")` will match `codex.png`. Prefix icon filenames to avoid collisions (e.g. `icon-x.png` instead of `x.png`).
- **Lucide icons**: Embedded as white-on-transparent PNGs in `Resources/Lucide/`. Downloaded as SVGs from `unpkg.com/lucide-static@latest/icons/{name}.svg`, converted to 40x40 white PNGs via Swift/AppKit (replace `currentColor` with `#FFFFFF` in SVG before rendering). Rendered via `BitmapBuilder.DrawImage()` — much sharper than Unicode chars on LCD.
- **Agent icons**: PNG files in `Resources/Icons/` (claude, gemini, aider, opencode from simulator, codex provided separately). Codex only has SVG in simulator — needs a real PNG.
- **Plugin reload**: `open loupedeck:plugin/AgentDeck/reload` triggers hot reload without killing the service. If service isn't running, start it with `open /Applications/Utilities/LogiPluginService.app`. `pkill -f LogiPluginService` kills it but it does NOT auto-restart — must be started manually.
- **Tile vertical alignment**: Use percentage-based zones (top 55-60% for icon, bottom 35-40% for label) with `DrawText` bounding boxes for centering. All tile types (Ctrl, Status, Info) must use identical zones to align across a row.
- **No hold/long-press support**: The SDK only fires `RunCommand` with no duration metadata. Workaround: use double-tap detection (track last tap position + timestamp, threshold ~400ms).
- **Profile actions with dropdown**: Use `MakeProfileAction("tree")` in constructor + override `GetProfileActionData()` returning a `PluginProfileActionTree`. Requires exactly **2 levels** (`tree.AddLevel()` twice) — single-level trees don't enable the Save button. Add nodes at level 1 via `tree.Root.AddNode(name)`, then items at level 2 via `node.AddItem(id, displayName, null)` (third param must be `null`). The `id` from `AddItem` is passed to `RunCommand` as `actionParameter`. Note: `GetCommandImage` receives SDK internal GUIDs, not your item IDs — so tile bitmaps can't be dynamic per selection. Tile label comes from the tree item display name.
- **`AddParameter` sub-items don't appear in Options+**: Despite `AddParameter()` registering entries, they don't show as separate draggable actions in the Options+ list. Use profile actions (`MakeProfileAction("tree")`) with dropdowns instead for parameterized commands.
- **Full service restart clears tile caches**: `open loupedeck:plugin/AgentDeck/reload` hot-reloads code but preserves stale tile renders. `pkill -f LogiPluginService` + restart clears all caches including tile bitmaps and labels.
- **`hasReset` on adjustments**: Setting `hasReset: true` in `PluginDynamicAdjustment` constructor creates a separate "Reset" action in Options+. Set to `false` if you don't want that extra action cluttering the list.
- **View-switch cooldown**: When navigating between Dynamic Folder views (e.g. double-tap → skills page), block input for ~1 second to prevent accidental third-tap triggering a skill action immediately.
- **Action symbols** (icons in Logi Options+ action picker): Place SVGs in `package/actionsymbols/` named `{FullNamespace}.{ClassName}.svg` (e.g. `Loupedeck.AgentDeckPlugin.Commands.CycleAgentCommand.svg`). SVGs must be **32x32 viewBox**, use **filled paths with `fill="#E2E2E2"`** (light gray), **no strokes** — Logi+ recolors the `#E2E2E2` fill on hover. Do NOT use `stroke`-based SVGs or `fill="none"` outlines — Logi+ ignores stroke attributes and auto-fills closed shapes with black. Reference official symbols at `/Applications/Utilities/LogiPluginService.app/Contents/MonoBundle/Plugins/DefaultMac/actionsymbols/` for the correct format. Requires service restart to pick up changes. **Note:** `PluginDynamicFolder` does NOT support action symbols — only commands and adjustments get icons in the Logi+ picker.
- **Creating action symbol SVGs**: Lucide icons are stroke-based but Logi+ needs filled outline paths (32x32, `fill="#E2E2E2"`, `fill-rule="evenodd"`). Workflow: (1) download Lucide SVG from `unpkg.com/lucide-static@latest/icons/{name}.svg` with `curl -sL`, (2) manually convert stroke paths to filled outline paths in a Node.js script — define each icon's paths as arrays of `d` strings, wrap in `<svg width="32" height="32" viewBox="0 0 32 32">` with `<path fill="#E2E2E2" fill-rule="evenodd" clip-rule="evenodd">`. To resize icons within the 32x32 canvas (e.g. 75%), wrap paths in `<g transform="translate(4,4) scale(0.75)">`. See `/tmp/convert_icons.mjs` for the pattern used to generate the current icons.

### Simulator

```bash
cd packages/simulator
bun dev              # http://localhost:8888
```

### Release / Packaging

```bash
npm run release          # Build both packages into releases/v{version}-{timestamp}-{commit}/
```

Produces:
- `AgentDeck-{version}.lplug4` — Logi Plugin (double-click or `logiplugintool install` to install)
- `agentdeck-{version}.vsix` — VS Code Extension (`code --install-extension` or Windsurf "Install from VSIX")
- `BUILD_INFO.txt` — version, commit, date for traceability

Bump version before a new release:
```bash
npm version patch --prefix packages/vscode-extension --no-git-tag-version
```

The `releases/` directory is gitignored. The Logi plugin version is set in `packages/logi-plugin/src/package/metadata/LoupedeckPackage.yaml` (update `version:` manually to match). Requires `dotnet` (Homebrew) and `logiplugintool` (.NET global tool) — see script at `scripts/release.sh` for PATH setup.

## Build Phase Deliverables

### Required — VS Code Extension
- [x] Agent manager (spawn/kill via terminals, auto-attach)
- [x] Status parser (terminal output → status, 5 agents + generic)
- [x] AI status classifier (optional Ollama fallback for uncertain detection)
- [x] WebSocket server (:9999)
- [x] Sidebar agent list with live status
- [x] Integrated terminal per agent
- [x] Commands (approve, reject, new, kill, show terminal, attach)
- [x] Responds to FocusAgent from Logi plugin
- [x] Simulator webview panel
- [x] Diff viewer for approvals — `diff-viewer.ts` with git diff integration + dial scrubbing (nav_left/nav_right)

### Required — Logi Plugin
- [x] Plugin scaffolding (AgentDeckPlugin.cs, models, services)
- [x] BridgeClient (WebSocket connection to extension :9999)
- [x] Basic commands (AgentSlot, NewAgent, Status, Custom)
- [x] Dial + roller adjustments
- [x] Dynamic Folder with agent status tiles — `AgentDashboardFolder.cs` takes over 9 LCD buttons (dashboard/skills/new-agent/menu views)
- [x] NEW agent flow with agent type picker — 5 agent types + WORKTREE toggle in new-agent view
- [x] Skills page via double-tap — Commit, Fix, Test, Refactor, Review, Explain + END (any agent status)
- [x] Window focus — osascript activates correct editor window by workspace name on tile tap
- [ ] Actions Ring commands (8 quick actions) — only 4 commands exist, missing: Approve, Reject, NextWaiting, Kill, OpenTerminal
- [ ] Haptic notifications on MX Master 4 — no haptic code
- [ ] Default profile (.lp5 pre-assigns folder to button)

### Required — Simulator
- [x] Web-based console testing (dashboard, approval flow, cancel, keyboard shortcuts)

### Nice to Have
- [ ] Cost tracking display
- [x] Git worktree isolation — per-agent worktrees with toggle on NEW grid, auto-generated branches
- [x] Agent skills page — Commit, Fix, Test, Refactor, Review, Explain + END (any agent, via double-tap)
- [ ] Session forking
- [ ] Windows support

### Deliverables
- [ ] 3-minute demo video
- [ ] Public GitHub repository
- [ ] Release: .lplug4 + .vsix

## Future Improvements

### Status Detection: Hooks & Structured APIs over Terminal Parsing

Terminal escape sequence detection (BEL, OSC 9/777) handles the most critical transition (working→waiting) reliably for Claude Code. But the heuristic pattern matching for other transitions and agents is still brittle — TUI redraws, stale patterns, and agent UI updates cause false positives. Several agents expose structured status mechanisms that would be even more reliable:

| Agent | Mechanism | How |
|---|---|---|
| **Claude Code** | [Hooks API](https://docs.anthropic.com/en/docs/claude-code/hooks) (12 lifecycle events) | Install hooks in `~/.claude/settings.json`: `PreToolUse`→running, `Notification` (matcher: `permission_prompt\|elicitation_dialog`)→waiting, `Stop`→idle. Write status to file or post to WebSocket. Agent-of-empires uses this approach — their terminal parser for Claude is a stub. |
| **Gemini CLI** | `--output-format stream-json` | JSONL event stream in headless mode. Eliminates terminal parsing entirely. |
| **OpenCode** | [SDK + SSE](https://opencode.ai/docs/sdk/) (`/event` endpoint) | Real-time events via `opencode-sdk-js`. |
| **Codex** | None | Terminal parsing only. |
| **Aider** | None | Terminal parsing only. |

Priority: Claude Code hooks (highest impact — most complex detector, most used agent).

### Git Worktree Isolation for Multi-Agent

When multiple agents work on the same repo, they clobber each other's files. Git worktrees solve this — each agent gets its own working directory and branch, sharing the same `.git` object database (lightweight).

**Recommended UX**: Don't auto-worktree by default. Instead, prompt when a 2nd agent is launched on the same repo: "Multiple agents on same repo. Launch in worktree?" with an "Always" option. Add `agentdeck.worktree.enabled` setting (default `false`).

**Implementation**:
- On launch: `git worktree add .claude/worktrees/<agent-id> -b worktree-<agent-id>` → set terminal `cwd` to worktree path
- On agent exit: clean worktree → auto-remove. Dirty → keep, notify user
- Protocol: add `worktreePath?` and `worktreeBranch?` to `AgentSession`
- Sidebar/keypad: show branch name per agent

Reference: agent-of-empires uses worktrees (disabled by default, opt-in). Claude Code has built-in `--worktree` flag.

### Agent Skills Page (Implemented)

Inspired by [Conductor](https://devpost.com/software/conductor-tpdnkj)'s skill-based workflow. **Double-tap** any agent tile on the dashboard (any status) to open the skills page:

- Skills send a message to the agent's terminal (e.g. "fix the failing tests", "refactor this file")
- **END** button kills the agent session
- **BACK** returns to dashboard
- Works for any agent status — single tap always focuses terminal, double tap always opens skills

### Diff Scrubbing via Dial

Use the MX Creative Console dial to navigate through an agent's changeset — rotate to switch between changed files, press to toggle navigation mode.

**VS Code APIs**:
- Git extension API (`vscode.extensions.getExtension('vscode.git')`) — list all changed files
- `git.openChange` — open a specific file's diff view
- `workbench.action.editor.nextChange` / `previousChange` — navigate hunks within a diff
- `workbench.action.nextEditor` / `previousEditor` — switch between open diff tabs

**Design**:
- **Dial rotation** → cycle through git changed files (opens each file's diff view)
- **Dial press** → toggle between file-level (rotate = next file) and hunk-level (rotate = next hunk) navigation
- **LCD feedback** → show current file name + position (e.g., `3/7 files` or `hunk 2/5`)
- **MX Master roller** → already scrolls within current diff natively (no code needed)

**Implementation**:
- Extension tracks changed files via Git extension API: `repo.state.workingTreeChanges` + `repo.state.indexChanges`
- On dial rotate: `vscode.commands.executeCommand('git.openChange', changedFiles[index].uri)`
- On dial press: toggle `scrubMode` between `'file'` and `'hunk'`
- In hunk mode: `vscode.commands.executeCommand('workbench.action.editor.nextChange')`
- Broadcast current position to Logi Plugin for LCD tile update

**Scope**: Per-agent — each agent has its own worktree/branch, so changed files are scoped to that agent's work. Without worktrees, shows all repo changes (still useful for single-agent).

### Reference: Competitor Submissions

- [Conductor](https://devpost.com/software/conductor-tpdnkj) — single-agent, skill-based workflow with diff scrubbing via dial and checkpoint timeline. Uses same hardware (MX Creative Console). No multi-agent support. Concept phase (no working prototype linked).

## Resources

- [Logi Actions SDK Documentation](https://logitech.github.io/actions-sdk-docs/)
- [Actions SDK C# Plugin Development](https://logitech.github.io/actions-sdk-docs/csharp/plugin-development/introduction/)
- [Actions SDK Plugin Features](https://logitech.github.io/actions-sdk-docs/csharp/plugin-features/)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [VS Code Terminal API](https://code.visualstudio.com/api/references/vscode-api#Terminal)
- [VS Code Proposed APIs](https://code.visualstudio.com/api/advanced-topics/using-proposed-api) (terminalDataWriteEvent)
