// ============================================================
// WebSocket protocol: Extension ↔ Logi Plugin / Simulator
// ============================================================

// Extension → Client

export interface StateUpdate {
  type: 'state';
  agents: AgentSession[];
}

export interface AgentSession {
  id: string;
  slot: number;
  name: string;
  agent: string;
  status: AgentStatus;
  projectPath: string;
  createdAt: string;
  approval?: ApprovalRequest;
}

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'error' | 'offline';

export interface ApprovalRequest {
  type: 'file_edit' | 'command' | 'question';
  summary: string;
  files?: FileChange[];
  command?: string;
  fullContent: string;
}

export interface FileChange {
  path: string;
  diff: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface AgentEvent {
  type: 'event';
  agentId: string;
  event: 'needs_approval' | 'completed' | 'error';
}

export interface FocusAgent {
  type: 'focus';
  agentId: string;
  view: 'terminal' | 'diff' | 'sidebar';
}

// Client → Extension

export interface AgentCommand {
  type: 'command';
  agentId: string;
  action: 'approve' | 'reject' | 'pause' | 'resume' | 'kill';
}

export interface LaunchAgent {
  type: 'launch';
  projectPath: string;
  agent: string;
  message?: string;
}

export interface OpenTerminal {
  type: 'open_terminal';
  agentId: string;
}

export type ClientMessage = AgentCommand | LaunchAgent | OpenTerminal;
export type ServerMessage = StateUpdate | AgentEvent | FocusAgent;

export const SUPPORTED_AGENTS = ['claude', 'gemini', 'aider', 'codex', 'opencode'] as const;
export type AgentType = typeof SUPPORTED_AGENTS[number];

export function agentCommand(agent: AgentType): string {
  switch (agent) {
    case 'claude': return 'claude';
    case 'gemini': return 'gemini';
    case 'aider': return 'aider';
    case 'codex': return 'codex';
    case 'opencode': return 'opencode';
  }
}
