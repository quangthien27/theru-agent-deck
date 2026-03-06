// ============================================================
// Agent Deck types (from Agent Deck's web API)
// ============================================================

export interface MenuSnapshot {
  profile: string;
  generatedAt: string;
  totalGroups: number;
  totalSessions: number;
  items: MenuItem[];
}

export interface MenuItem {
  index: number;
  type: 'group' | 'session';
  level: number;
  path: string;
  group?: MenuGroup;
  session?: MenuSession;
  isLastInGroup: boolean;
  isSubSession: boolean;
}

export interface MenuGroup {
  name: string;
  path: string;
  expanded: boolean;
  order: number;
  sessionCount: number;
}

export interface MenuSession {
  id: string;
  title: string;
  tool: string;
  status: string;
  groupPath: string;
  projectPath: string;
  parentSessionId: string;
  order: number;
  tmuxSession: string;
  createdAt: string;
  lastAccessedAt: string;
}

// ============================================================
// Bridge ↔ Plugin protocol (our WebSocket messages)
// ============================================================

// Bridge → Plugin

export interface StateUpdate {
  type: 'state';
  agents: AgentSession[];
}

export interface AgentSession {
  id: string;
  slot: number;
  name: string;
  agent: string;
  status: PluginStatus;
  projectPath: string;
  createdAt: string;
  approval?: ApprovalRequest;
}

export type PluginStatus = 'idle' | 'working' | 'waiting' | 'error' | 'offline';

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

// Plugin → Bridge

export interface AgentCommand {
  type: 'command';
  agentId: string;
  action: 'approve' | 'reject' | 'pause' | 'resume' | 'kill';
  payload?: string;
}

export interface LaunchAgent {
  type: 'launch';
  projectPath: string;
  agent: string;
}

export interface OpenTerminal {
  type: 'open_terminal';
  agentId: string;
}

export type PluginMessage = AgentCommand | LaunchAgent | OpenTerminal;

export type BridgeMessage = StateUpdate | AgentEvent;
