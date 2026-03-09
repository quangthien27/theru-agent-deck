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
      const dirName = agent.projectPath.split('/').pop() || '?';
      const elapsed = formatElapsed(agent.createdAt);
      this.description = `${agent.agent} \u00B7 ${dirName} \u00B7 ${statusLabel(agent.status)} \u00B7 ${elapsed}`;

      const approvalLine = agent.approval ? `\n\n**Needs input:** ${agent.approval.summary}` : '';
      this.tooltip = new vscode.MarkdownString(
        `**${agent.name}** \u2014 ${agent.agent}\n\n` +
        `$(${statusThemeIcon(agent.status)}) ${statusLabel(agent.status)}\n\n` +
        `**Project:** \`${dirName}\`\n\n` +
        `**Path:** ${agent.projectPath}\n\n` +
        `**Session:** ${elapsed}` +
        approvalLine
      );
      this.tooltip.supportThemeIcons = true;

      this.contextValue = `agent-${agent.status}`;

      // Click to show terminal
      this.command = {
        command: 'agentdeck.showTerminal',
        title: 'Show Terminal',
        arguments: [agent.id],
      };

      // Use theme icon for visual distinction
      this.iconPath = new vscode.ThemeIcon(
        statusThemeIcon(agent.status),
        statusThemeColor(agent.status)
      );

      // Override label to just the name (icon comes from iconPath)
      this.label = agent.name;
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

function statusThemeIcon(status: AgentStatus | 'none'): string {
  switch (status) {
    case 'working': return 'sync~spin';
    case 'waiting': return 'bell-dot';
    case 'idle': return 'circle-outline';
    case 'error': return 'error';
    case 'offline': return 'circle-slash';
    default: return 'circle-outline';
  }
}

function statusThemeColor(status: AgentStatus): vscode.ThemeColor | undefined {
  switch (status) {
    case 'working': return new vscode.ThemeColor('charts.green');
    case 'waiting': return new vscode.ThemeColor('charts.yellow');
    case 'error': return new vscode.ThemeColor('charts.red');
    case 'idle': return new vscode.ThemeColor('descriptionForeground');
    case 'offline': return new vscode.ThemeColor('disabledForeground');
    default: return undefined;
  }
}

function statusLabel(status: AgentStatus): string {
  switch (status) {
    case 'working': return 'Running';
    case 'waiting': return 'Needs Input';
    case 'idle': return 'Ready';
    case 'error': return 'Error';
    case 'offline': return 'Offline';
  }
}

function formatElapsed(isoDate: string): string {
  if (!isoDate) return '';
  const elapsed = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (elapsed < 0) return '0s';
  if (elapsed < 60) return `${elapsed}s`;
  const m = Math.floor(elapsed / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
