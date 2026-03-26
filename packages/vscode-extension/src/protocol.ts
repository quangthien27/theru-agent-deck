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
  worktreePath?: string;
  worktreeBranch?: string;
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
  action: 'approve' | 'reject' | 'pause' | 'resume' | 'kill' | 'restart' | 'checkpoint'
        | 'nav_up' | 'nav_down' | 'nav_left' | 'nav_right';
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

export interface ToggleWorktree {
  type: 'toggle_worktree';
}

export interface GetSettings {
  type: 'get_settings';
}

export const AGENT_SKILLS = [
  { id: 'commit',   label: 'Commit',   icon: '⏎', prompt: '/commit' },
  { id: 'fix',      label: 'Fix',      icon: '🔧', prompt: 'fix the failing tests and errors' },
  { id: 'test',     label: 'Test',     icon: '✓', prompt: 'run the tests and fix any failures' },
  { id: 'refactor', label: 'Refactor', icon: '♻', prompt: 'refactor the recent changes for clarity' },
  { id: 'review',   label: 'Review',   icon: '👁', prompt: 'review the recent changes and suggest improvements' },
  { id: 'explain',  label: 'Explain',  icon: '💡', prompt: 'explain what the recent changes do' },
] as const;

export type SkillId = typeof AGENT_SKILLS[number]['id'];

export interface SkillCommand {
  type: 'skill';
  agentId: string;
  skillId: string;       // one of AGENT_SKILLS[].id or 'custom'
  customPrompt?: string; // only for skillId === 'custom'
}

export interface FocusView {
  type: 'focus_view';
  view: 'sidebar' | 'diff';
  agentId?: string;
}

export type ClientMessage = AgentCommand | LaunchAgent | OpenTerminal | ToggleWorktree | GetSettings | SkillCommand | FocusView;
// Extension → Client (diff scrubbing position feedback)
export interface DiffPosition {
  type: 'diff_position';
  agentId: string;
  fileIndex: number;
  fileCount: number;
  fileName: string;
  mode: 'file' | 'hunk';
}

export interface SettingsUpdate {
  type: 'settings';
  worktreeEnabled: boolean;
}

export type ServerMessage = StateUpdate | AgentEvent | FocusAgent | DiffPosition | SettingsUpdate;

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
