import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import type { AgentSession, AgentStatus, AgentType } from './protocol';
interface ManagedAgent {
    id: string;
    agent: AgentType;
    name: string;
    projectPath: string;
    createdAt: string;
    status: AgentStatus;
    terminal: vscode.Terminal;
    outputBuffer: string;
}
export declare class AgentManager extends EventEmitter {
    private agents;
    private terminalToAgent;
    private nextId;
    private statusCheckInterval;
    private disposables;
    private log;
    constructor(outputChannel: vscode.OutputChannel);
    getAgents(): AgentSession[];
    getAgent(id: string): ManagedAgent | undefined;
    launch(agentType: AgentType, projectPath: string, message?: string): string;
    approve(agentId: string): boolean;
    reject(agentId: string): boolean;
    pause(agentId: string): boolean;
    kill(agentId: string): boolean;
    showTerminal(agentId: string): void;
    getTerminalBuffer(agentId: string): string;
    private stuckCount;
    private checkStatuses;
    private emitStateChange;
    dispose(): void;
}
export {};
//# sourceMappingURL=agent-manager.d.ts.map