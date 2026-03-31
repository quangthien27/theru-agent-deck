# AgentDeck

A physical control surface for managing multiple AI coding agents. Pair your Logitech MX Creative Console with VS Code to get glanceable status, one-tap approvals, and instant agent switching — without leaving your editor.

## What it does

- **Spawn & manage agents** — Launch Claude Code, Gemini CLI, Aider, Codex, or OpenCode as managed terminals
- **Live status detection** — Automatically detects when agents are running, waiting for input, idle, or errored
- **MX Creative Console integration** — Color-coded LCD tiles show agent status at a glance; tap to focus, double-tap for skills
- **Multi-window support** — Each editor window gets its own WebSocket server; the console sees all agents across windows
- **Auto-attach** — Detects manually launched agents in any terminal and promotes them to managed sessions
- **Git worktree isolation** — Optionally launch each agent in its own worktree so they don't clobber each other
- **Diff viewer** — Browse an agent's changes with dial scrubbing on the MX Creative Console
- **Smart Continue** — The Continue skill adapts to agent state: approves when waiting for yes/no, nudges with "continue" when idle

## Requirements

- VS Code 1.93+, Windsurf, or Cursor
- [Logitech MX Creative Console](https://www.logitech.com/products/keyboards/mx-creative-console.html) (optional — the extension works standalone with the sidebar)
- Logi Options+ with the AgentDeck plugin installed (for console integration)

## Getting started

1. Install the extension
2. The AgentDeck sidebar appears in the activity bar
3. Click **+** to launch a new agent, or type an agent command in any terminal — AgentDeck will auto-attach
4. If you have an MX Creative Console, install the AgentDeck Logi plugin and assign the AgentDeck folder to a button

## Dial & roller sensitivity

The MX Creative Console dial uses tick accumulation to prevent accidental switches. Sensitivity is controlled by a single constant (`DialStepThreshold` in the Logi plugin) — higher values require more rotation per step. Default is 10 ticks per step.

## Status

Early development — features and APIs may change.
