import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AgentSession, AgentStatus, AgentType } from './protocol';
import { agentCommand, SUPPORTED_AGENTS } from './protocol';
import { detectStatus, parseApproval, stripAnsi } from './status-parser';
import type { OllamaClassifier } from './ai-classifier';

const execFileAsync = promisify(execFile);

/** Max chars to keep in agent output buffer (status detection window) */
const OUTPUT_BUFFER_CAP = 8000;
/** Max chars to buffer for untracked terminal auto-detection */
const AUTO_DETECT_BUFFER_CAP = 16000;

interface ManagedAgent {
  id: string;
  agent: AgentType;
  name: string;
  projectPath: string;
  createdAt: string;
  status: AgentStatus;
  terminal: vscode.Terminal;
  outputBuffer: string;
  /** Buffer length when AI last classified — skip if buffer hasn't grown enough */
  aiLastBufLen: number;
  worktreePath?: string;
  worktreeBranch?: string;
}

export class AgentManager extends EventEmitter {
  private agents = new Map<string, ManagedAgent>();
  private terminalToAgent = new Map<vscode.Terminal, string>();
  private nextId = 1;
  private statusCheckInterval: NodeJS.Timeout | null = null;
  private disposables: vscode.Disposable[] = [];
  private log: vscode.OutputChannel;
  private aiClassifier: OllamaClassifier | null = null;

  constructor(outputChannel: vscode.OutputChannel) {
    super();
    this.log = outputChannel;

    // Track terminal close
    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        // Clean up auto-attach buffers
        this.untrackedBuffers.delete(terminal);
        this.untrackedIgnored.delete(terminal);

        const agentId = this.terminalToAgent.get(terminal);
        if (agentId) {
          this.terminalToAgent.delete(terminal);
          this.agents.delete(agentId);
          this.stuckCount.delete(agentId);
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
            if (agent.outputBuffer.length > OUTPUT_BUFFER_CAP) {
              agent.outputBuffer = agent.outputBuffer.slice(-OUTPUT_BUFFER_CAP);
            }
            // Log cleaned preview (strip ANSI, collapse whitespace)
            const cleaned = stripAnsi(chunk).replace(/\s+/g, ' ').trim();
            if (cleaned.length > 0) {
              const preview = cleaned.length > 120 ? cleaned.slice(0, 120) + '...' : cleaned;
              this.log.appendLine(`[DATA ${agentId}] ${preview}`);
            }
          }
        } else {
          // Untracked terminal — try to auto-detect agent type from output
          this.tryAutoAttach(e.terminal, e.data);
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
        worktreePath: agent.worktreePath,
        worktreeBranch: agent.worktreeBranch,
      });
    }
    return result;
  }

  getAgent(id: string): ManagedAgent | undefined {
    return this.agents.get(id);
  }

  private createManagedAgent(
    id: string, agentType: AgentType, terminal: vscode.Terminal, projectPath: string,
  ): ManagedAgent {
    const dirName = projectPath.split('/').filter(Boolean).pop() || agentType;
    return {
      id,
      agent: agentType,
      name: dirName.slice(0, 8).toUpperCase(),
      projectPath,
      createdAt: new Date().toISOString(),
      status: 'working',
      terminal,
      outputBuffer: '',
      aiLastBufLen: 0,
    };
  }

  launch(agentType: AgentType, projectPath: string, message?: string): string {
    const id = `agent-${this.nextId++}`;
    const worktreeEnabled = vscode.workspace.getConfiguration('agentdeck').get<boolean>('worktree.enabled', true);

    if (worktreeEnabled) {
      // Async worktree creation — launch happens inside the callback
      this.launchWithWorktree(id, agentType, projectPath, message);
    } else {
      this.launchInDirectory(id, agentType, projectPath, message);
    }

    return id;
  }

  private async launchWithWorktree(
    id: string, agentType: AgentType, projectPath: string, message?: string,
  ): Promise<void> {
    const dirName = projectPath.split('/').filter(Boolean).pop() || 'proj';
    const ts = Date.now().toString(36).slice(-4); // short 4-char timestamp
    const branch = `agentdeck/${agentType}-${dirName}-${ts}`;
    const worktreePath = `${projectPath}/.agentdeck/worktrees/${agentType}-${dirName}-${ts}`;

    try {
      // Create worktree directory parent
      await execFileAsync('mkdir', ['-p', `${projectPath}/.agentdeck/worktrees`]);
      // Create worktree with a new branch
      await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath], { cwd: projectPath });
      this.log.appendLine(`[WORKTREE ${id}] Created: ${worktreePath} branch=${branch}`);

      this.launchInDirectory(id, agentType, worktreePath, message, worktreePath, branch);
    } catch (err: any) {
      this.log.appendLine(`[WORKTREE ${id}] Failed: ${err.message} — falling back to main tree`);
      this.launchInDirectory(id, agentType, projectPath, message);
    }
  }

  private launchInDirectory(
    id: string, agentType: AgentType, cwd: string, message?: string,
    worktreePath?: string, worktreeBranch?: string,
  ): void {
    const cmd = agentCommand(agentType);

    // Build args — launch in interactive mode, optionally with an initial message
    const args: string[] = [];
    if (message) {
      if (agentType === 'aider') {
        args.push('--message', message);
      }
    }

    // Generate short name from project path (use original path, not worktree)
    const dirName = cwd.split('/').filter(Boolean).pop() || agentType;

    const terminalName = worktreeBranch
      ? `AgentDeck: ${agentType} (${dirName}) [${worktreeBranch}]`
      : `AgentDeck: ${agentType} (${dirName})`;

    const terminal = vscode.window.createTerminal({
      name: terminalName,
      cwd,
    });

    terminal.show();

    const fullCmd = [cmd, ...args].map(a => a.includes(' ') ? `"${a}"` : a).join(' ');
    terminal.sendText(fullCmd);

    if (message && agentType !== 'aider') {
      setTimeout(() => {
        terminal.sendText(message);
      }, 3000);
    }

    const agent = this.createManagedAgent(id, agentType, terminal, cwd);
    agent.worktreePath = worktreePath;
    agent.worktreeBranch = worktreeBranch;
    this.agents.set(id, agent);
    this.terminalToAgent.set(terminal, id);
    this.log.appendLine(`[LAUNCH ${id}] agent=${agentType} cmd="${fullCmd}" cwd=${cwd}${worktreeBranch ? ` worktree=${worktreeBranch}` : ''}`);
    this.emitStateChange();
  }

  approve(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== 'waiting') return false;
    // Send Enter — selects current/default option in both [Y/n] prompts
    // and multi-option menus (Claude's numbered lists, checkboxes, etc.)
    agent.terminal.sendText('', true); // sendText('', true) → sends \r
    agent.status = 'working';
    this.emitStateChange();
    return true;
  }

  reject(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== 'waiting') return false;
    // Send Esc — universally cancels/dismisses prompts
    agent.terminal.sendText('\x1b', false);
    agent.status = 'working';
    this.emitStateChange();
    return true;
  }

  /** Send navigation keys to interact with multi-option prompts */
  navigate(agentId: string, direction: 'up' | 'down' | 'left' | 'right'): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    // ANSI escapes: Up=ESC[A Down=ESC[B Right=ESC[C Left=ESC[D
    // Tab also navigates in Claude prompts — left/right map to Shift+Tab/Tab
    const seqs: Record<string, string> = {
      up: '\x1b[A',
      down: '\x1b[B',
      right: '\t',       // Tab — next tab/section
      left: '\x1b[Z',    // Shift+Tab — previous tab/section
    };
    agent.terminal.sendText(seqs[direction], false);
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
    this.stuckCount.delete(agentId);
    this.emitStateChange();
    return true;
  }

  showTerminal(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.terminal.show();
    }
  }

  /** Send a text message to an agent's terminal (for skills / custom prompts) */
  sendMessage(agentId: string, text: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.terminal.show();
    agent.terminal.sendText(text);
    agent.status = 'working';
    this.emitStateChange();
    return true;
  }

  getTerminalBuffer(agentId: string): string {
    const agent = this.agents.get(agentId);
    return agent?.outputBuffer || '';
  }

  /** Returns terminals already tracked by AgentDeck */
  getTrackedTerminals(): Set<vscode.Terminal> {
    return new Set(this.terminalToAgent.keys());
  }

  /** Attach an existing terminal as a managed agent */
  attach(terminal: vscode.Terminal, agentType: AgentType, projectPath: string): string {
    // Don't attach if already tracked
    if (this.terminalToAgent.has(terminal)) {
      return this.terminalToAgent.get(terminal)!;
    }

    const id = `agent-${this.nextId++}`;
    const agent = this.createManagedAgent(id, agentType, terminal, projectPath);
    this.agents.set(id, agent);
    this.terminalToAgent.set(terminal, id);
    this.log.appendLine(`[ATTACH ${id}] agent=${agentType} terminal="${terminal.name}" cwd=${projectPath}`);
    this.emitStateChange();
    return id;
  }

  // ── Auto-attach untracked terminals ──────────────────────
  // Buffer output from untracked terminals. Once enough data arrives,
  // check for agent signatures and auto-attach if found.
  private untrackedBuffers = new Map<vscode.Terminal, string>();
  private untrackedIgnored = new Set<vscode.Terminal>();

  // Unique branding strings per agent — no generic phrases, no version numbers
  // These must match text visible AFTER stripping ANSI codes
  private static AGENT_SIGNATURES: { agent: AgentType; patterns: string[] }[] = [
    { agent: 'claude', patterns: ['ClaudeCode', 'Claude Code'] },
    { agent: 'gemini', patterns: ['GEMINI.md', 'Gemini CLI', '(see /docs)'] },
    { agent: 'codex', patterns: ['OpenAI Codex'] },
    { agent: 'aider', patterns: ['Aider v'] },
    { agent: 'opencode', patterns: ['tab agents', 'ctrl+p commands'] },
  ];

  // Pre-compiled shell command patterns: "% cmd", "$ cmd", "# cmd"
  private static SHELL_PATTERNS: { agent: AgentType; regex: RegExp }[] =
    SUPPORTED_AGENTS.map(agent => ({
      agent,
      regex: new RegExp(`[%$#]\\s+${agent}(\\s|$)`),
    }));

  private tryAutoAttach(terminal: vscode.Terminal, chunk: string): void {
    // Check setting
    if (!vscode.workspace.getConfiguration('agentdeck').get<boolean>('autoAttach', true)) return;

    // Skip terminals we already decided to ignore
    if (this.untrackedIgnored.has(terminal)) return;

    // Accumulate output
    let buf = this.untrackedBuffers.get(terminal) || '';
    buf += chunk;

    // Don't check until we have enough data, but cap the buffer
    if (buf.length > AUTO_DETECT_BUFFER_CAP) {
      // Too much output and no match — give up on this terminal
      const preview = stripAnsi(buf).replace(/\s+/g, ' ').trim().slice(-500);
      this.log.appendLine(`[AUTO-DETECT GIVE-UP] terminal="${terminal.name}" buf=${buf.length} tail: ${preview}`);
      this.untrackedBuffers.delete(terminal);
      this.untrackedIgnored.add(terminal);
      return;
    }
    this.untrackedBuffers.set(terminal, buf);

    // Need at least some data before checking
    if (buf.length < 50) return;

    const stripped = stripAnsi(buf);

    // Debug: log at key buffer milestones
    for (const milestone of [200, 1000, 2000, 3000]) {
      if (buf.length >= milestone && buf.length - chunk.length < milestone) {
        const preview = stripped.replace(/\s+/g, ' ').trim().slice(-400);
        this.log.appendLine(`[AUTO-DETECT @${milestone}] terminal="${terminal.name}" buf=${buf.length} tail: ${preview}`);
        break;
      }
    }

    // 1. Check unique branding strings
    for (const sig of AgentManager.AGENT_SIGNATURES) {
      for (const pattern of sig.patterns) {
        if (stripped.includes(pattern)) {
          this.doAutoAttach(terminal, sig.agent, buf, `brand: "${pattern}"`);
          return;
        }
      }
    }

    // 2. Check shell command echo: "% cmd" or "$ cmd" (e.g. "% gemini", "$ claude")
    for (const sp of AgentManager.SHELL_PATTERNS) {
      if (sp.regex.test(stripped)) {
        this.doAutoAttach(terminal, sp.agent, buf, `shell: "${sp.agent}"`);
        return;
      }
    }
  }

  private doAutoAttach(terminal: vscode.Terminal, agentType: AgentType, bufferedOutput: string, reason: string): void {
    // Determine project path from terminal name or workspace
    const folders = vscode.workspace.workspaceFolders;
    const projectPath = folders?.[0]?.uri.fsPath || '';

    if (!projectPath) {
      this.log.appendLine(`[AUTO-ATTACH] Skipped — no workspace folder (${reason})`);
      return;
    }

    // Clean up untracked buffers
    this.untrackedBuffers.delete(terminal);
    this.untrackedIgnored.add(terminal); // Don't re-check this terminal

    // Attach as managed agent
    const id = this.attach(terminal, agentType, projectPath);

    // Feed buffered output so status detection has data
    const agent = this.agents.get(id);
    if (agent) {
      agent.outputBuffer = bufferedOutput;
    }

    this.log.appendLine(`[AUTO-ATTACH ${id}] ${agentType} detected via ${reason}`);
    vscode.window.showInformationMessage(`AgentDeck: Auto-attached ${agentType} agent from terminal "${terminal.name}"`);
  }

  private aiLog: { appendLine(value: string): void } | null = null;

  setAIClassifier(classifier: OllamaClassifier, aiLog?: { appendLine(value: string): void }): void {
    this.aiClassifier?.dispose();
    this.aiClassifier = classifier;
    this.aiLog = aiLog || this.log;
    this.aiLog.appendLine('AI classifier attached to AgentManager');
  }

  clearAIClassifier(): void {
    this.aiClassifier?.dispose();
    this.aiClassifier = null;
  }

  private stuckCount = new Map<string, number>();

  /** Confidence threshold: below this, fire AI classifier for a second opinion */
  private static AI_CONFIDENCE_THRESHOLD = 0.6;
  /** Minimum buffer growth before re-querying AI (avoid flooding on tiny changes) */
  private static AI_MIN_BUFFER_DELTA = 100;

  private checkStatuses(): void {
    let changed = false;
    for (const agent of this.agents.values()) {
      const prev = agent.status;
      const bufLen = agent.outputBuffer.length;

      const result = detectStatus(agent.outputBuffer, agent.status, agent.agent);
      agent.status = result.status;

      if (agent.status !== prev) {
        changed = true;
        this.stuckCount.set(agent.id, 0);
        agent.aiLastBufLen = 0; // Reset so AI can re-evaluate after status change
        this.log.appendLine(`[STATUS ${agent.id}] ${prev} → ${agent.status} (conf: ${result.confidence.toFixed(2)}, buf: ${bufLen}, agent: ${agent.agent})`);
        const tail = stripAnsi(agent.outputBuffer.slice(-500)).replace(/\s+/g, ' ').trim().slice(-300);
        this.log.appendLine(`[BUFFER ${agent.id}] ...${tail}`);
        this.emit('statusChange', agent.id, prev, agent.status);
      }

      // AI fallback: fire when heuristic confidence is low (ambiguous or no match).
      // Only re-query if buffer has grown enough since last AI call.
      if (result.confidence < AgentManager.AI_CONFIDENCE_THRESHOLD
          && this.aiClassifier
          && (bufLen - agent.aiLastBufLen) >= AgentManager.AI_MIN_BUFFER_DELTA) {
        const stripped = stripAnsi(agent.outputBuffer.slice(-2000));
        const agentId = agent.id;
        const currentStatus = agent.status;
        const heuristicConf = result.confidence;
        agent.aiLastBufLen = bufLen;
        this.aiClassifier.classify(stripped, agent.agent, agentId)
          .then(aiResult => {
            if (aiResult && aiResult.status !== currentStatus) {
              const a = this.agents.get(agentId);
              if (a && a.status === currentStatus) {
                const aiPrev = a.status;
                a.status = aiResult.status;
                this.aiLog!.appendLine(`[AI ${agentId}] ${aiPrev} → ${aiResult.status} (ai-conf: ${aiResult.confidence.toFixed(2)}, heuristic-conf: ${heuristicConf.toFixed(2)})`);
                this.emit('statusChange', agentId, aiPrev, aiResult.status);
                this.emitStateChange();
              }
            }
          })
          .catch(() => {});
      }

      if (agent.status === prev && agent.status === 'working' && bufLen > 200) {
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
