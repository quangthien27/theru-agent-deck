import * as vscode from 'vscode';
import type { AgentSession, AgentStatus } from './protocol';

export class AgentSidebarProvider implements vscode.TreeDataProvider<AgentTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private agents: AgentSession[] = [];

  updateAgents(agents: AgentSession[]): void {
    this.agents = agents;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AgentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): AgentTreeItem[] {
    if (this.agents.length === 0) {
      return [new AgentTreeItem(
        'No agents running',
        'none',
        '',
        vscode.TreeItemCollapsibleState.None
      )];
    }

    return this.agents.map(agent => new AgentTreeItem(
      `${statusIcon(agent.status)} ${agent.name}`,
      agent.status,
      agent.id,
      vscode.TreeItemCollapsibleState.None,
      agent
    ));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

class AgentTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    private status: AgentStatus | 'none',
    public readonly agentId: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    agent?: AgentSession
  ) {
    super(label, collapsibleState);

    if (agent) {
      this.description = `${agent.agent} · ${agent.projectPath.split('/').pop()}`;
      this.tooltip = new vscode.MarkdownString(
        `**${agent.name}** (${agent.agent})\n\n` +
        `Status: ${agent.status}\n\n` +
        `Project: ${agent.projectPath}\n\n` +
        (agent.approval ? `⚠ ${agent.approval.summary}` : '')
      );
      this.contextValue = `agent-${agent.status}`;

      // Click to show terminal
      this.command = {
        command: 'agentdeck.showTerminal',
        title: 'Show Terminal',
        arguments: [agent.id],
      };
    } else {
      this.contextValue = 'no-agents';
    }
  }
}

function statusIcon(status: AgentStatus): string {
  switch (status) {
    case 'working': return '$(sync~spin)';
    case 'waiting': return '$(bell)';
    case 'idle': return '$(circle-outline)';
    case 'error': return '$(error)';
    case 'offline': return '$(circle-slash)';
  }
}
