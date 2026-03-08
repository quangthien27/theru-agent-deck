import * as vscode from 'vscode';
import type { AgentManager } from './agent-manager';
import type { AgentType } from './protocol';
import { SUPPORTED_AGENTS } from './protocol';
import { openSimulatorWebview } from './simulator-webview';

export function registerCommands(
  context: vscode.ExtensionContext,
  agentManager: AgentManager
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

      const id = agentManager.launch(agentType.label as AgentType, projectPath, message || undefined);
      agentManager.showTerminal(id);
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
      const id = agentId || getWaitingAgentId(agentManager);
      if (!id) {
        vscode.window.showInformationMessage('No agent with pending approval');
        return;
      }
      // Show the terminal for now — diff viewer will be enhanced later
      agentManager.showTerminal(id);
    }),

    vscode.commands.registerCommand('agentdeck.openSimulator', () => {
      openSimulatorWebview(context);
    }),
  );
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
