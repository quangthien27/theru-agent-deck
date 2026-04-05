import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AgentSession, AgentStatus, AgentType } from './protocol';
import { agentCommand, SUPPORTED_AGENTS } from './protocol';
import { detectStatus, parseApproval, stripAnsi } from './status-parser';
import type { OllamaClassifier } from './ai-classifier';
import { spawnAgentPty, isNodePtyAvailable } from './agent-pty';
import type { AgentPtyHandle } from './agent-pty';

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
  ptyHandle?: AgentPtyHandle;
  dataDisposable?: vscode.Disposable;
  outputBuffer: string;
  /** Buffer length when AI last classified — skip if buffer hasn't grown enough */
  aiLastBufLen: number;
  worktreePath?: string;
  worktreeBranch?: string;
  /** Track if we're inside an OSC sequence (spans chunks) — BEL as OSC terminator is NOT a bell */
  inOscSequence: boolean;
  /** Timestamp of last bare BEL — debounce at 100ms like Ghostty */
  lastBellTime: number;
  /** Timestamp of most recent data chunk received from PTY (ms). 0 = no data yet. */
  lastDataChunkTime: number;
}

export class AgentManager extends EventEmitter {
  private agents = new Map<string, ManagedAgent>();
  private terminalToAgent = new Map<vscode.Terminal, string>();
  private nextId = 1;
  private port = 9999;
  private statusCheckInterval: NodeJS.Timeout | null = null;
  private disposables: vscode.Disposable[] = [];
  private log: vscode.OutputChannel;
  private aiClassifier: OllamaClassifier | null = null;

  /** Set the port prefix for globally unique agent IDs across windows */
  setPort(port: number): void {
    this.port = port;
  }

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

    // Auto-attach via Shell Integration API (stable, works in production).
    // Detects when user types an agent command (claude, gemini, etc.) in any terminal,
    // auto-attaches it, and streams output via execution.read() for status detection.
    if (vscode.window.onDidStartTerminalShellExecution) {
      this.disposables.push(
        vscode.window.onDidStartTerminalShellExecution((event) => {
          if (!vscode.workspace.getConfiguration('agentdeck').get<boolean>('autoAttach', true)) return;
          if (this.terminalToAgent.has(event.terminal)) return;

          const cmdLine = event.execution.commandLine.value.trim();
          const cmd = cmdLine.split(/\s+/)[0];
          const agentType = SUPPORTED_AGENTS.find(a => cmd === a || cmd.endsWith(`/${a}`));
          if (!agentType) return;

          const folders = vscode.workspace.workspaceFolders;
          const projectPath = folders?.[0]?.uri.fsPath || '';
          if (!projectPath) return;

          const id = this.attach(event.terminal, agentType, projectPath);
          this.log.appendLine(`[AUTO-ATTACH ${id}] ${agentType} detected via shell integration: "${cmdLine}"`);
          vscode.window.showInformationMessage(`AgentDeck: Auto-attached ${agentType} from terminal`);

          // Stream output via execution.read() for status detection
          (async () => {
            try {
              for await (const data of event.execution.read()) {
                this.handleAgentOutput(id, data);
              }
            } catch {
              this.log.appendLine(`[AUTO-ATTACH ${id}] Output stream ended`);
            }
          })();
        })
      );
      this.log.appendLine('[AgentManager] Auto-attach active (Shell Integration API)');
    } else {
      this.log.appendLine('[AgentManager] Auto-attach disabled (Shell Integration API not available)');
    }

    this.log.appendLine(`[AgentManager] Initialized (node-pty: ${isNodePtyAvailable() ? 'yes' : 'no'})`);

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
    // Use workspace folder name for display (not worktree path)
    const folders = vscode.workspace.workspaceFolders;
    const workspaceName = folders?.[0]?.name || projectPath.split('/').filter(Boolean).pop() || agentType;
    return {
      id,
      agent: agentType,
      name: workspaceName.slice(0, 8).toUpperCase(),
      projectPath,
      createdAt: new Date().toISOString(),
      status: 'working',
      terminal,
      outputBuffer: '',
      aiLastBufLen: 0,
      inOscSequence: false,
      lastBellTime: 0,
      lastDataChunkTime: 0,
    };
  }

  launch(agentType: AgentType, projectPath: string, message?: string,
    opts?: { thinking?: string; mode?: string; effort?: string }): string {
    const id = `w${this.port}-agent-${this.nextId++}`;
    const worktreeEnabled = vscode.workspace.getConfiguration('agentdeck').get<boolean>('worktree.enabled', true);

    if (worktreeEnabled) {
      // Async worktree creation — launch happens inside the callback
      this.launchWithWorktree(id, agentType, projectPath, message, opts);
    } else {
      this.launchInDirectory(id, agentType, projectPath, message, undefined, undefined, opts);
    }

    return id;
  }

  private async launchWithWorktree(
    id: string, agentType: AgentType, projectPath: string, message?: string,
    opts?: { thinking?: string; mode?: string; effort?: string },
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

      this.launchInDirectory(id, agentType, worktreePath, message, worktreePath, branch, opts);
    } catch (err: any) {
      this.log.appendLine(`[WORKTREE ${id}] Failed: ${err.message} — falling back to main tree`);
      this.launchInDirectory(id, agentType, projectPath, message, undefined, undefined, opts);
    }
  }

  /** Handle output from an agent's terminal — escape sequence detection + buffering */
  private handleAgentOutput(agentId: string, chunk: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // ── Escape sequence detection (Ghostty-style state machine) ──
    // Track OSC state across chunks so BEL-as-OSC-terminator isn't mistaken for bare BEL.
    const escapes: string[] = [];
    let bareBellCount = 0;

    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];

      if (ch === '\x1b' && i + 1 < chunk.length) {
        if (chunk[i + 1] === ']') {
          // OSC sequence start — BEL inside this is a terminator, not a bell
          agent.inOscSequence = true;

          // Log specific OSC types
          const rest = chunk.slice(i);
          if (rest.startsWith('\x1b]9;')) escapes.push('OSC9');
          else if (rest.startsWith('\x1b]777;')) escapes.push('OSC777');
          else if (rest.startsWith('\x1b]2;')) escapes.push('OSC2-title');
        } else if (chunk[i + 1] === '[') {
          const rest = chunk.slice(i);
          if (rest.startsWith('\x1b[2J')) escapes.push('CLEAR-2J');
          if (rest.startsWith('\x1b[3J')) escapes.push('CLEAR-3J');
        } else if (chunk[i + 1] === '\\' && agent.inOscSequence) {
          // ST (String Terminator) ends OSC — alternative to BEL
          agent.inOscSequence = false;
        }
      } else if (ch === '\x07') {
        if (agent.inOscSequence) {
          // BEL as OSC terminator — NOT a bell
          agent.inOscSequence = false;
        } else {
          // Bare BEL — real bell signal
          bareBellCount++;
        }
      }
    }

    if (bareBellCount > 0) escapes.push(`BEL(\\x07)x${bareBellCount}`);
    if (escapes.length > 0) {
      this.log.appendLine(`[ESC ${agentId}] detected: ${escapes.join(', ')}  (status=${agent.status}, chunk=${chunk.length}b)`);
    }

    // Bare BEL = agent requesting attention. Debounce at 100ms (like Ghostty).
    if (bareBellCount > 0 && agent.status === 'working') {
      const now = Date.now();
      if (now - agent.lastBellTime >= 100) {
        agent.lastBellTime = now;
        this.log.appendLine(`[BEL ${agentId}] Bare bell detected — agent needs input`);
        const prev = agent.status;
        agent.status = 'waiting';
        this.emit('statusChange', agentId, prev, 'waiting');
        this.emitStateChange();
      }
    }

    // OSC 9 / 777 desktop notifications
    if (chunk.includes('\x1b]9;') || chunk.includes('\x1b]777;')) {
      const oscMatch = chunk.match(/\x1b\](?:9;([^\x07]*)|777;notify;([^;]*);([^\x07]*))\x07/);
      if (oscMatch) {
        const body = oscMatch[1] || oscMatch[3] || '';
        const title = oscMatch[2] || '';
        this.log.appendLine(`[OSC-NOTIFY ${agentId}] title="${title}" body="${body.slice(0, 100)}"`);
      }
    }

    // OSC 2 title change
    if (chunk.includes('\x1b]2;')) {
      const titleMatch = chunk.match(/\x1b\]2;([^\x07\x1b]*)/);
      if (titleMatch) {
        this.log.appendLine(`[TITLE ${agentId}] "${titleMatch[1].slice(0, 80)}"`);
      }
    }

    // Clear screen resets buffer
    if (chunk.includes('\x1b[2J') || chunk.includes('\x1b[3J')) {
      agent.outputBuffer = chunk;
    } else {
      agent.outputBuffer += chunk;
    }
    if (agent.outputBuffer.length > OUTPUT_BUFFER_CAP) {
      agent.outputBuffer = agent.outputBuffer.slice(-OUTPUT_BUFFER_CAP);
    }

    const cleaned = stripAnsi(chunk).replace(/\s+/g, ' ').trim();
    if (cleaned.length > 0) {
      const preview = cleaned.length > 120 ? cleaned.slice(0, 120) + '...' : cleaned;
      this.log.appendLine(`[DATA ${agentId}] ${preview}`);
    }

    agent.lastDataChunkTime = Date.now();
  }

  private launchInDirectory(
    id: string, agentType: AgentType, cwd: string, message?: string,
    worktreePath?: string, worktreeBranch?: string,
    opts?: { thinking?: string; mode?: string; effort?: string },
  ): void {
    const cmd = agentCommand(agentType);

    // Build args — launch in interactive mode, optionally with an initial message
    const args: string[] = [];
    if (message) {
      if (agentType === 'aider') {
        args.push('--message', message);
      }
    }

    // CLI flags from launch options (currently Claude Code only)
    if (agentType === 'claude') {
      if (opts?.thinking) {
        const budgetMap: Record<string, string> = { low: '5000', medium: '20000', high: '50000' };
        const tokens = budgetMap[opts.thinking] || opts.thinking;
        args.push('--thinking-budget-tokens', tokens);
      }
      if (opts?.mode === 'bypassPermissions') args.push('--dangerously-skip-permissions');
      else if (opts?.mode) args.push('--permission-mode', opts.mode === 'auto' ? 'autoApprove' : opts.mode);
      if (opts?.effort) args.push('--effort', opts.effort);
    }

    const dirName = cwd.split('/').filter(Boolean).pop() || agentType;
    const terminalName = worktreeBranch
      ? `AgentDeck: ${agentType} (${dirName}) [${worktreeBranch}]`
      : `AgentDeck: ${agentType} (${dirName})`;

    let terminal: vscode.Terminal;
    let ptyHandle: AgentPtyHandle | undefined;
    let dataDisposable: vscode.Disposable | undefined;

    if (isNodePtyAvailable()) {
      // Pseudoterminal approach — full output capture via stable API
      ptyHandle = spawnAgentPty({ command: cmd, args, cwd, name: terminalName });
      terminal = ptyHandle.terminal;
      dataDisposable = ptyHandle.onData((chunk) => this.handleAgentOutput(id, chunk));

      if (message && agentType !== 'aider') {
        setTimeout(() => ptyHandle!.write(message + '\r'), 3000);
      }
    } else {
      // Fallback: native terminal (no output capture, status detection via polling only)
      terminal = vscode.window.createTerminal({ name: terminalName, cwd });
      const fullCmd = [cmd, ...args].map(a => a.includes(' ') ? `"${a}"` : a).join(' ');
      terminal.sendText(fullCmd);

      if (message && agentType !== 'aider') {
        setTimeout(() => terminal.sendText(message), 3000);
      }
    }

    terminal.show();
    this.focusEditorWindow();

    const agent = this.createManagedAgent(id, agentType, terminal, cwd);
    agent.ptyHandle = ptyHandle;
    agent.dataDisposable = dataDisposable;
    agent.worktreePath = worktreePath;
    agent.worktreeBranch = worktreeBranch;
    this.agents.set(id, agent);
    this.terminalToAgent.set(terminal, id);

    const logCmd = ptyHandle ? `${cmd} ${args.join(' ')}` : `${cmd} ${args.join(' ')} (native terminal)`;
    this.log.appendLine(`[LAUNCH ${id}] agent=${agentType} cmd="${logCmd}" cwd=${cwd}${worktreeBranch ? ` worktree=${worktreeBranch}` : ''}`);
    this.emitStateChange();
  }

  /** Send raw data to agent — uses pty if available, falls back to terminal.sendText */
  private writeToAgent(agent: ManagedAgent, data: string): void {
    if (agent.ptyHandle) {
      agent.ptyHandle.write(data);
    } else {
      agent.terminal.sendText(data, false);
    }
  }

  approve(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== 'waiting') return false;
    this.writeToAgent(agent, '\r');
    agent.status = 'working';
    this.emitStateChange();
    return true;
  }

  reject(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== 'waiting') return false;
    this.writeToAgent(agent, '\x1b');
    agent.status = 'working';
    this.emitStateChange();
    return true;
  }

  navigate(agentId: string, direction: 'up' | 'down' | 'left' | 'right'): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    const seqs: Record<string, string> = {
      up: '\x1b[A',
      down: '\x1b[B',
      right: '\t',
      left: '\x1b[Z',
    };
    this.writeToAgent(agent, seqs[direction]);
    return true;
  }

  pause(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    this.writeToAgent(agent, '\x03');
    return true;
  }

  resume(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    this.writeToAgent(agent, '\r');
    return true;
  }

  /** Restart agent — kills and re-launches same type in same project/worktree */
  restart(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    const { agent: agentType, projectPath } = agent;
    const hadWorktree = !!agent.worktreePath;
    this.kill(agentId);
    // Re-launch with same params after a short delay for terminal cleanup
    // launch() will auto-create a new worktree if worktree setting is enabled
    // and the original agent had one
    setTimeout(() => {
      this.launch(agentType as any, projectPath);
    }, 500);
  }

  cycleMode(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    this.writeToAgent(agent, '\x1b[Z'); // Shift+Tab
    return true;
  }

  /** Create a git checkpoint tag in agent's working directory */
  checkpoint(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    const cwd = agent.worktreePath || agent.projectPath;
    const tag = `agentdeck/checkpoint/${agentId}/${Date.now()}`;
    execFile('git', ['tag', tag], { cwd }, (err) => {
      if (err) {
        this.log.appendLine(`[CHECKPOINT ${agentId}] Failed: ${err.message}`);
      } else {
        this.log.appendLine(`[CHECKPOINT ${agentId}] Created tag: ${tag}`);
      }
    });
  }

  kill(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    if (agent.dataDisposable) agent.dataDisposable.dispose();
    if (agent.ptyHandle) {
      agent.ptyHandle.kill();
    } else {
      agent.terminal.dispose();
    }
    this.terminalToAgent.delete(agent.terminal);
    this.agents.delete(agentId);
    this.stuckCount.delete(agentId);
    this.emitStateChange();
    return true;
  }

  /** Bring the editor window to foreground via OS-level focus (osascript/powershell) */
  private focusEditorWindow(): void {
    if (process.platform === 'darwin') {
      const folders = vscode.workspace.workspaceFolders;
      const folderName = folders?.[0]?.name || '';
      const workspaceName = vscode.workspace.name || '';
      const bundleId = vscode.env.uriScheme || 'vscode';
      // Build list of candidate names to match against window title.
      // Users may set a custom window.title like "Man of Many${separator}..." — extract the static prefix.
      const candidates = new Set([folderName, workspaceName].filter(n => n.length > 0));
      const titleTemplate = vscode.workspace.getConfiguration('window').get<string>('title', '');
      if (titleTemplate) {
        // Extract static text before first ${...} variable
        const staticPrefix = titleTemplate.split('${')[0].trim().replace(/[-—]$/, '').trim();
        if (staticPrefix.length > 2) candidates.add(staticPrefix);
      }
      this.log.appendLine(`[FOCUS] bundleId="${bundleId}" candidates=${JSON.stringify([...candidates])}`);

      // AppleScript: try each candidate name against window titles
      const conditions = [...candidates].map(name =>
        `if name of w contains "${name}" then\n` +
        `        perform action "AXRaise" of w\n` +
        `        return "raised: " & name of w\n` +
        `      end if`
      ).join('\n      ');

      execFile('osascript', ['-e',
        `tell application "System Events"\n` +
        `  set matchedProcs to every process whose bundle identifier contains "${bundleId}"\n` +
        `  if (count of matchedProcs) = 0 then return "no process"\n` +
        `  set p to item 1 of matchedProcs\n` +
        `  set frontmost of p to true\n` +
        `  set windowNames to {}\n` +
        `  repeat with w in (every window of p)\n` +
        `    set end of windowNames to name of w\n` +
        `    ${conditions}\n` +
        `  end repeat\n` +
        `  return "no match in: " & (windowNames as text)\n` +
        `end tell`
      ], (err, stdout) => {
        if (err) {
          this.log.appendLine(`[FOCUS] osascript error: ${err.message}`);
        } else if (stdout) {
          this.log.appendLine(`[FOCUS] osascript result: ${stdout.trim()}`);
        }
      });
    } else if (process.platform === 'win32') {
      const appName = vscode.env.appName || 'Code';
      execFile('powershell', ['-Command',
        `(New-Object -ComObject WScript.Shell).AppActivate("${appName}")`]);
    }
  }

  showTerminal(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.focusEditorWindow();
      agent.terminal.show();
    }
  }

  /** Send a text message to an agent's terminal (for skills / custom prompts) */
  sendMessage(agentId: string, text: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.terminal.show();

    if (agent.ptyHandle) {
      // With pty, write text then carriage return. TUI agents handle it correctly
      // since the pty provides proper raw mode.
      const tuiAgents = ['gemini', 'opencode', 'codex'];
      if (tuiAgents.includes(agent.agent)) {
        agent.ptyHandle.write(text);
        setTimeout(() => agent.ptyHandle!.write('\r'), 100);
      } else {
        agent.ptyHandle.write(text + '\r');
      }
    } else {
      // Fallback: native terminal
      const tuiAgents = ['gemini', 'opencode', 'codex'];
      if (tuiAgents.includes(agent.agent)) {
        agent.terminal.sendText(text, false);
        setTimeout(() => agent.terminal.sendText('', true), 100);
      } else {
        agent.terminal.sendText(text);
      }
    }

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

  /** Returns the agent ID for a terminal, or undefined if not tracked */
  getAgentIdForTerminal(terminal: vscode.Terminal): string | undefined {
    return this.terminalToAgent.get(terminal);
  }

  /** Attach an existing terminal as a managed agent */
  attach(terminal: vscode.Terminal, agentType: AgentType, projectPath: string): string {
    // Don't attach if already tracked
    if (this.terminalToAgent.has(terminal)) {
      return this.terminalToAgent.get(terminal)!;
    }

    const id = `w${this.port}-agent-${this.nextId++}`;
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

      let result = detectStatus(agent.outputBuffer, agent.status, agent.agent);

      // Silence-based fallback: if heuristic found no pattern match (confidence=0.0)
      // and the agent has been quiet longer than its silence threshold, synthesize idle.
      // TUI agents stream spinner updates every ~100-200ms while working — sustained
      // silence means they're done even when buffer patterns are ambiguous.
      if (result.confidence === 0.0 && agent.status === 'working' && agent.lastDataChunkTime > 0) {
        const silenceMs = Date.now() - agent.lastDataChunkTime;
        const SILENCE_THRESHOLDS: Record<string, number> = {
          claude:   2000,   // spinners fire ~every 100ms — 2s silence = definitely done
          gemini:   5000,
          opencode: 5000,
          codex:    5000,
          aider:   10000,  // aider can pause several seconds during model inference
        };
        const silenceThreshold = SILENCE_THRESHOLDS[agent.agent] ?? 10000;
        if (silenceMs > silenceThreshold) {
          result = { status: 'idle', confidence: 0.4 };
          this.log.appendLine(`[SILENCE ${agent.id}] ${silenceMs}ms quiet → synthesizing idle (agent: ${agent.agent})`);
        }
      }

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
              // Don't let AI demote working → idle (small models misread TUI output).
              // AI should only promote: working→waiting, idle→waiting, etc.
              if (currentStatus === 'working' && aiResult.status === 'idle') {
                this.aiLog!.appendLine(`[AI ${agentId}] IGNORED: ${currentStatus} → ${aiResult.status} (ai-conf: ${aiResult.confidence.toFixed(2)}, heuristic-conf: ${heuristicConf.toFixed(2)})`);
                return;
              }
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
      if (agent.dataDisposable) agent.dataDisposable.dispose();
      if (agent.ptyHandle) {
        agent.ptyHandle.kill();
      } else {
        agent.terminal.dispose();
      }
    }
    this.agents.clear();
    this.terminalToAgent.clear();
  }
}
