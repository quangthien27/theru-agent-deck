import * as vscode from 'vscode';
import type { AgentSession, AgentStatus } from './protocol';
export declare class AgentSidebarProvider implements vscode.TreeDataProvider<AgentTreeItem> {
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<void | AgentTreeItem | undefined>;
    private agents;
    updateAgents(agents: AgentSession[]): void;
    getTreeItem(element: AgentTreeItem): vscode.TreeItem;
    getChildren(): AgentTreeItem[];
    dispose(): void;
}
declare class AgentTreeItem extends vscode.TreeItem {
    private status;
    readonly agentId: string;
    constructor(label: string, status: AgentStatus | 'none', agentId: string, collapsibleState: vscode.TreeItemCollapsibleState, agent?: AgentSession);
}
export {};
//# sourceMappingURL=sidebar-provider.d.ts.map