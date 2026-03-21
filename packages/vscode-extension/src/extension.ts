import * as vscode from 'vscode';
import { AgentManager } from './agent-manager';
import { WSServer } from './ws-server';
import { AgentSidebarProvider } from './sidebar-provider';
import { registerCommands } from './commands';
import { OllamaClassifier } from './ai-classifier';
import { DiffViewer } from './diff-viewer';
import type { ClientMessage, AgentStatus } from './protocol';
import { AGENT_SKILLS } from './protocol';

const WS_PORT = 9999;

let agentManager: AgentManager;
let wsServer: WSServer;
let sidebarProvider: AgentSidebarProvider;
let statusBarItem: vscode.StatusBarItem;
let diffViewer: DiffViewer;

export function activate(context: vscode.ExtensionContext) {
  const sessionsLog = vscode.window.createOutputChannel('AgentDeck Sessions');
  const aiLog = vscode.window.createOutputChannel('AgentDeck AI');
  context.subscriptions.push(sessionsLog, aiLog);

  try {
  // ── Agent Manager ──────────────────────────────────────
  agentManager = new AgentManager(sessionsLog);

  // ── AI Classifier (optional Ollama fallback) ─────────
  function applyAISettings() {
    const cfg = vscode.workspace.getConfiguration('agentdeck');
    const enabled = cfg.get<boolean>('ai.enabled', false);
    if (enabled) {
      const url = cfg.get<string>('ai.ollamaUrl', 'http://localhost:11434');
      const mdl = cfg.get<string>('ai.model', 'qwen2.5:0.5b');
      agentManager.setAIClassifier(new OllamaClassifier(url, mdl, aiLog), aiLog);
      aiLog.appendLine(`Ollama classifier enabled: ${url} model=${mdl}`);
    } else {
      agentManager.clearAIClassifier();
      aiLog.appendLine('Ollama classifier disabled');
    }
  }
  applyAISettings();

  // Re-apply when settings change — no restart needed
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('agentdeck.ai')) {
        applyAISettings();
      }
    }),
  );

  // ── Sidebar ────────────────────────────────────────────
  sidebarProvider = new AgentSidebarProvider();
  const treeView = vscode.window.createTreeView('agentdeck.agents', {
    treeDataProvider: sidebarProvider,
    showCollapseAll: false,
  });

  // ── Status Bar ─────────────────────────────────────────
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.command = 'agentdeck.newAgent';
  updateStatusBar([]);
  statusBarItem.show();

  // ── WebSocket Server ───────────────────────────────────
  wsServer = new WSServer();
  wsServer.start(WS_PORT);
  wsServer.setMessageHandler((msg: ClientMessage) => {
    handleClientMessage(msg);
  });

  // ── State broadcast ────────────────────────────────────
  agentManager.on('stateChange', (agents) => {
    sidebarProvider.updateAgents(agents);
    updateStatusBar(agents);
    wsServer.broadcast({ type: 'state', agents });
  });

  agentManager.on('statusChange', (agentId: string, prev: AgentStatus, next: AgentStatus) => {
    // Emit events for Logi Plugin haptics
    if (next === 'waiting') {
      wsServer.broadcast({ type: 'event', agentId, event: 'needs_approval' });
    } else if (next === 'idle' && prev === 'working') {
      wsServer.broadcast({ type: 'event', agentId, event: 'completed' });
    } else if (next === 'error') {
      wsServer.broadcast({ type: 'event', agentId, event: 'error' });
    }
  });

  // ── Diff Viewer ──────────────────────────────────────────
  diffViewer = new DiffViewer(sessionsLog, (pos) => {
    wsServer.broadcast(pos);
  });

  // Clean up diff state when agent is killed
  agentManager.on('stateChange', (agents) => {
    // Remove diff state for agents that no longer exist
    const agentIds = new Set(agents.map((a: { id: string }) => a.id));
    for (const id of diffViewer.getActiveAgentIds()) {
      if (!agentIds.has(id)) {
        diffViewer.remove(id);
      }
    }
  });

  // ── Commands ───────────────────────────────────────────
  registerCommands(context, agentManager, diffViewer);

  // ── Cleanup ────────────────────────────────────────────
  context.subscriptions.push(
    treeView,
    statusBarItem,
    { dispose: () => agentManager.dispose() },
    { dispose: () => wsServer.stop() },
    { dispose: () => sidebarProvider.dispose() },
  );

  sessionsLog.appendLine(`AgentDeck activated. WebSocket server on :${WS_PORT}`);

  } catch (err: any) {
    sessionsLog.appendLine(`[AgentDeck] Activation error: ${err.message}\n${err.stack}`);
    vscode.window.showErrorMessage(`AgentDeck failed to activate: ${err.message}`);
  }
}

export function deactivate() {
  agentManager?.dispose();
  wsServer?.stop();
}

// ── Handle messages from Logi Plugin / Simulator ──────────

function handleClientMessage(msg: ClientMessage): void {
  switch (msg.type) {
    case 'command':
      switch (msg.action) {
        case 'approve':
          agentManager.approve(msg.agentId);
          break;
        case 'reject':
          agentManager.reject(msg.agentId);
          break;
        case 'pause':
          agentManager.pause(msg.agentId);
          break;
        case 'kill':
          agentManager.kill(msg.agentId);
          break;
        case 'nav_up':
          agentManager.navigate(msg.agentId, 'up');
          break;
        case 'nav_down':
          agentManager.navigate(msg.agentId, 'down');
          break;
        case 'nav_left':
          if (diffViewer.isActive(msg.agentId)) {
            diffViewer.navigate(msg.agentId, 'prev');
          } else {
            agentManager.navigate(msg.agentId, 'left');
          }
          break;
        case 'nav_right':
          if (diffViewer.isActive(msg.agentId)) {
            diffViewer.navigate(msg.agentId, 'next');
          } else {
            agentManager.navigate(msg.agentId, 'right');
          }
          break;
      }
      break;

    case 'launch': {
      // Resolve project path — WebSocket clients may send "." or empty
      let projectPath = msg.projectPath;
      if (!projectPath || projectPath === '.') {
        const folders = vscode.workspace.workspaceFolders;
        projectPath = folders?.[0]?.uri.fsPath || '';
      }
      if (!projectPath) {
        vscode.window.showWarningMessage('AgentDeck: No workspace folder open to launch agent in.');
        break;
      }
      agentManager.launch(msg.agent as any, projectPath, msg.message);
      break;
    }

    case 'open_terminal':
      agentManager.showTerminal(msg.agentId);
      // Also send focus message back to other clients
      wsServer.broadcast({
        type: 'focus',
        agentId: msg.agentId,
        view: 'terminal',
      });
      break;

    case 'toggle_worktree': {
      const cfg = vscode.workspace.getConfiguration('agentdeck');
      const current = cfg.get<boolean>('worktree.enabled', true);
      cfg.update('worktree.enabled', !current, vscode.ConfigurationTarget.Global);
      wsServer.broadcast({ type: 'settings', worktreeEnabled: !current });
      break;
    }

    case 'get_settings': {
      const worktreeEnabled = vscode.workspace.getConfiguration('agentdeck').get<boolean>('worktree.enabled', true);
      wsServer.broadcast({ type: 'settings', worktreeEnabled });
      break;
    }

    case 'skill': {
      if (msg.skillId === 'custom') {
        if (msg.customPrompt) {
          agentManager.sendMessage(msg.agentId, msg.customPrompt);
        } else {
          // Open VS Code input box for custom prompt
          vscode.window.showInputBox({ prompt: 'Enter message for agent' }).then(text => {
            if (text) agentManager.sendMessage(msg.agentId, text);
          });
        }
      } else {
        const skill = AGENT_SKILLS.find(s => s.id === msg.skillId);
        if (skill) {
          agentManager.sendMessage(msg.agentId, skill.prompt);
        }
      }
      break;
    }
  }
}

// ── Status bar ────────────────────────────────────────────

function updateStatusBar(agents: { status: string }[]): void {
  const total = agents.length;
  const waiting = agents.filter(a => a.status === 'waiting').length;
  const working = agents.filter(a => a.status === 'working').length;
  const errors = agents.filter(a => a.status === 'error').length;

  if (total === 0) {
    statusBarItem.text = '$(plug) AgentDeck';
    statusBarItem.tooltip = 'No agents running. Click to launch one.';
    return;
  }

  let parts = [`$(plug) ${total} agent${total > 1 ? 's' : ''}`];
  if (waiting > 0) parts.push(`$(bell) ${waiting}`);
  if (working > 0) parts.push(`$(sync~spin) ${working}`);
  if (errors > 0) parts.push(`$(error) ${errors}`);

  statusBarItem.text = parts.join('  ');
  statusBarItem.tooltip = `AgentDeck: ${total} agents (${working} working, ${waiting} waiting, ${errors} errors)`;
}
