import * as vscode from 'vscode';
import type { AgentManager } from './agent-manager';
import type { DiffViewer } from './diff-viewer';
import type { AgentType } from './protocol';
import { SUPPORTED_AGENTS } from './protocol';
import { openSimulatorWebview } from './simulator-webview';

export function registerCommands(
  context: vscode.ExtensionContext,
  agentManager: AgentManager,
  diffViewer: DiffViewer
): void {

  context.subscriptions.push(
    vscode.commands.registerCommand('agentdeck.newAgent', async () => {
      // Pick agent type
      const agentType = await vscode.window.showQuickPick(
        SUPPORTED_AGENTS.map(a => ({ label: a, description: `Launch ${a} agent` })),
        { placeHolder: 'Select agent type' }
      );
      if (!agentType) return;

      // Pick project folder
      const folders = vscode.workspace.workspaceFolders;
      let projectPath: string;

      if (folders && folders.length === 1) {
        projectPath = folders[0].uri.fsPath;
      } else if (folders && folders.length > 1) {
        const picked = await vscode.window.showQuickPick(
          folders.map(f => ({ label: f.name, description: f.uri.fsPath, path: f.uri.fsPath })),
          { placeHolder: 'Select project folder' }
        );
        if (!picked) return;
        projectPath = picked.path;
      } else {
        const uri = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          openLabel: 'Select Project Folder',
        });
        if (!uri || uri.length === 0) return;
        projectPath = uri[0].fsPath;
      }

      // Optional initial message
      const message = await vscode.window.showInputBox({
        prompt: 'Initial message for the agent (optional)',
        placeHolder: 'e.g., fix the login bug',
      });

      agentManager.launch(agentType.label as AgentType, projectPath, message || undefined);
      // Terminal is shown by launchInDirectory — no need to call showTerminal here
      // (worktree launch is async, agent may not exist yet)
    }),

    vscode.commands.registerCommand('agentdeck.approve', (agentId?: string) => {
      const id = agentId || getWaitingAgentId(agentManager);
      if (id) {
        agentManager.approve(id);
      } else {
        vscode.window.showInformationMessage('No agent waiting for approval');
      }
    }),

    vscode.commands.registerCommand('agentdeck.reject', (agentId?: string) => {
      const id = agentId || getWaitingAgentId(agentManager);
      if (id) {
        agentManager.reject(id);
      } else {
        vscode.window.showInformationMessage('No agent waiting for approval');
      }
    }),

    vscode.commands.registerCommand('agentdeck.kill', async (agentId?: string) => {
      const id = agentId || await pickAgent(agentManager, 'Select agent to kill');
      if (id) {
        agentManager.kill(id);
      }
    }),

    vscode.commands.registerCommand('agentdeck.showTerminal', (agentId?: string) => {
      if (agentId) {
        agentManager.showTerminal(agentId);
      }
    }),

    vscode.commands.registerCommand('agentdeck.showDiff', async (agentId?: string) => {
      const id = agentId || getWaitingAgentId(agentManager) || await pickAgent(agentManager, 'Select agent to show diff');
      if (!id) {
        vscode.window.showInformationMessage('No agent selected');
        return;
      }
      const agent = agentManager.getAgent(id);
      if (!agent) return;
      await diffViewer.show(id, agent.projectPath);
    }),

    vscode.commands.registerCommand('agentdeck.closeDiff', (agentId?: string) => {
      if (agentId) {
        diffViewer.remove(agentId);
      }
    }),

    vscode.commands.registerCommand('agentdeck.openSimulator', () => {
      openSimulatorWebview(context);
    }),

    vscode.commands.registerCommand('agentdeck.attachTerminal', async () => {
      const allTerminals = vscode.window.terminals;
      const tracked = agentManager.getTrackedTerminals();

      // Filter to untracked terminals
      const untracked = allTerminals.filter(t => !tracked.has(t));
      if (untracked.length === 0) {
        vscode.window.showInformationMessage('No untracked terminals to attach.');
        return;
      }

      // Let user pick a terminal
      const terminalItems = untracked.map(t => ({
        label: t.name,
        terminal: t,
      }));

      const picked = await vscode.window.showQuickPick(terminalItems, {
        placeHolder: 'Select a terminal to attach',
      });
      if (!picked) return;

      // Auto-detect agent type from terminal name, or ask
      const detected = detectAgentFromName(picked.label);
      let agentType: AgentType;

      if (detected) {
        agentType = detected;
      } else {
        const agentPick = await vscode.window.showQuickPick(
          SUPPORTED_AGENTS.map(a => ({ label: a, description: `Treat as ${a}` })),
          { placeHolder: `Agent type for "${picked.label}"` }
        );
        if (!agentPick) return;
        agentType = agentPick.label as AgentType;
      }

      // Use workspace folder as project path
      const folders = vscode.workspace.workspaceFolders;
      const projectPath = folders?.[0]?.uri.fsPath || '~';

      const id = agentManager.attach(picked.terminal, agentType, projectPath);
      vscode.window.showInformationMessage(`Attached "${picked.label}" as ${agentType} (${id})`);
    }),
  );
}

/** Try to detect agent type from terminal name */
function detectAgentFromName(name: string): AgentType | null {
  const lower = name.toLowerCase();
  for (const agent of SUPPORTED_AGENTS) {
    if (lower.includes(agent)) return agent;
  }
  return null;
}

function getWaitingAgentId(agentManager: AgentManager): string | undefined {
  const agents = agentManager.getAgents();
  const waiting = agents.find(a => a.status === 'waiting');
  return waiting?.id;
}

async function pickAgent(agentManager: AgentManager, placeholder: string): Promise<string | undefined> {
  const agents = agentManager.getAgents();
  if (agents.length === 0) {
    vscode.window.showInformationMessage('No agents running');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    agents.map(a => ({
      label: `${a.name} (${a.agent})`,
      description: a.status,
      id: a.id,
    })),
    { placeHolder: placeholder }
  );

  return picked?.id;
}
