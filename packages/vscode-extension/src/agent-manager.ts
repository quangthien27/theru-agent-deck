import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import type { AgentSession, AgentStatus, AgentType } from './protocol';
import { agentCommand } from './protocol';
import { detectStatus, parseApproval, stripAnsi } from './status-parser';

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

export class AgentManager extends EventEmitter {
  private agents = new Map<string, ManagedAgent>();
  private terminalToAgent = new Map<vscode.Terminal, string>();
  private nextId = 1;
  private statusCheckInterval: NodeJS.Timeout | null = null;
  private disposables: vscode.Disposable[] = [];
  private log: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    super();
    this.log = outputChannel;

    // Track terminal close
    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        const agentId = this.terminalToAgent.get(terminal);
        if (agentId) {
          const agent = this.agents.get(agentId);
          if (agent) {
            agent.status = 'offline';
            this.emitStateChange();
          }
          this.terminalToAgent.delete(terminal);
          this.agents.delete(agentId);
          this.emitStateChange();
        }
      })
    );

    // Capture terminal output for status detection
    this.disposables.push(
      vscode.window.onDidWriteTerminalData((e) => {
        const agentId = this.terminalToAgent.get(e.terminal);
        if (agentId) {
          const agent = this.agents.get(agentId);
          if (agent) {
            const chunk = e.data;
            agent.outputBuffer += chunk;
            if (agent.outputBuffer.length > 8000) {
              agent.outputBuffer = agent.outputBuffer.slice(-8000);
            }
            // Log cleaned preview (strip ANSI, collapse whitespace)
            const cleaned = stripAnsi(chunk).replace(/\s+/g, ' ').trim();
            if (cleaned.length > 0) {
              const preview = cleaned.length > 120 ? cleaned.slice(0, 120) + '...' : cleaned;
              this.log.appendLine(`[DATA ${agentId}] ${preview}`);
            }
          }
        }
      })
    );

    this.log.appendLine('[AgentManager] Initialized with onDidWriteTerminalData listener');

    // Periodically re-evaluate status from terminal output
    this.statusCheckInterval = setInterval(() => this.checkStatuses(), 2000);
  }

  getAgents(): AgentSession[] {
    const result: AgentSession[] = [];
    let slot = 0;
    for (const agent of this.agents.values()) {
      const approval = agent.status === 'waiting'
        ? parseApproval(agent.outputBuffer) ?? undefined
        : undefined;

      result.push({
        id: agent.id,
        slot: slot++,
        name: agent.name,
        agent: agent.agent,
        status: agent.status,
        projectPath: agent.projectPath,
        createdAt: agent.createdAt,
        approval,
      });
    }
    return result;
  }

  getAgent(id: string): ManagedAgent | undefined {
    return this.agents.get(id);
  }

  launch(agentType: AgentType, projectPath: string, message?: string): string {
    const id = `agent-${this.nextId++}`;
    const cmd = agentCommand(agentType);

    // Build args — launch in interactive mode, optionally with an initial message
    const args: string[] = [];
    if (message) {
      if (agentType === 'aider') {
        args.push('--message', message);
      }
      // For claude and others: send message after launch via sendText
    }

    // Generate short name from project path
    const dirName = projectPath.split('/').filter(Boolean).pop() || agentType;

    // Open a normal shell terminal, then send the agent command into it
    const terminal = vscode.window.createTerminal({
      name: `AgentDeck: ${agentType} (${dirName})`,
      cwd: projectPath,
    });

    terminal.show();

    // Build the full command string and send it to the shell
    const fullCmd = [cmd, ...args].map(a => a.includes(' ') ? `"${a}"` : a).join(' ');
    terminal.sendText(fullCmd);

    // If there's an initial message, send it after a short delay to let the agent start
    if (message && agentType !== 'aider') {
      setTimeout(() => {
        terminal.sendText(message);
      }, 3000);
    }

    const agent: ManagedAgent = {
      id,
      agent: agentType,
      name: dirName.slice(0, 8).toUpperCase(),
      projectPath,
      createdAt: new Date().toISOString(),
      status: 'working',
      terminal,
      outputBuffer: '',
    };

    this.agents.set(id, agent);
    this.terminalToAgent.set(terminal, id);
    this.log.appendLine(`[LAUNCH ${id}] agent=${agentType} cmd="${fullCmd}" cwd=${projectPath}`);
    this.emitStateChange();
    return id;
  }

  approve(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== 'waiting') return false;
    agent.terminal.sendText('y', true);
    agent.status = 'working';
    this.emitStateChange();
    return true;
  }

  reject(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== 'waiting') return false;
    agent.terminal.sendText('n', true);
    agent.status = 'working';
    this.emitStateChange();
    return true;
  }

  pause(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    // Send Ctrl+C via sendText with raw escape
    agent.terminal.sendText('\x03', false);
    return true;
  }

  kill(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.terminal.dispose();
    this.terminalToAgent.delete(agent.terminal);
    this.agents.delete(agentId);
    this.emitStateChange();
    return true;
  }

  showTerminal(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.terminal.show();
    }
  }

  getTerminalBuffer(agentId: string): string {
    const agent = this.agents.get(agentId);
    return agent?.outputBuffer || '';
  }

  private stuckCount = new Map<string, number>();

  private checkStatuses(): void {
    let changed = false;
    for (const agent of this.agents.values()) {
      const prev = agent.status;
      const bufLen = agent.outputBuffer.length;
      agent.status = detectStatus(agent.outputBuffer, agent.status, agent.agent);
      if (agent.status !== prev) {
        changed = true;
        this.stuckCount.set(agent.id, 0);
        this.log.appendLine(`[STATUS ${agent.id}] ${prev} → ${agent.status} (buf: ${bufLen} chars, agent: ${agent.agent})`);
        // Log last 300 chars of stripped buffer for context
        const tail = stripAnsi(agent.outputBuffer.slice(-500)).replace(/\s+/g, ' ').trim().slice(-300);
        this.log.appendLine(`[BUFFER ${agent.id}] ...${tail}`);
        this.emit('statusChange', agent.id, prev, agent.status);
      } else if (agent.status === 'working' && bufLen > 200) {
        // Log once when an agent has been stuck on "working" for a few cycles
        const count = (this.stuckCount.get(agent.id) || 0) + 1;
        this.stuckCount.set(agent.id, count);
        if (count === 5) {
          const tail = stripAnsi(agent.outputBuffer.slice(-800)).replace(/\s+/g, ' ').trim().slice(-500);
          this.log.appendLine(`[STUCK ${agent.id}] still working after ${count} checks (agent: ${agent.agent}, buf: ${bufLen})`);
          this.log.appendLine(`[STUCK ${agent.id}] tail: ${tail}`);
        }
      }
    }
    if (changed) {
      this.emitStateChange();
    }
  }

  private emitStateChange(): void {
    this.emit('stateChange', this.getAgents());
  }

  dispose(): void {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    for (const agent of this.agents.values()) {
      agent.terminal.dispose();
    }
    this.agents.clear();
    this.terminalToAgent.clear();
  }
}
