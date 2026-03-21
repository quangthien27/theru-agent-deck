import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { DiffPosition } from './protocol';

const execFileAsync = promisify(execFile);

interface ChangedFile {
  path: string;
  absPath: string;
  status: string; // M, A, D, R, etc.
}

interface AgentDiffState {
  agentId: string;
  projectPath: string;
  files: ChangedFile[];
  currentIndex: number;
  mode: 'file' | 'hunk';
}

export class DiffViewer {
  private states = new Map<string, AgentDiffState>();
  private log: vscode.OutputChannel;
  private onPositionChange: (pos: DiffPosition) => void;

  constructor(log: vscode.OutputChannel, onPositionChange: (pos: DiffPosition) => void) {
    this.log = log;
    this.onPositionChange = onPositionChange;
  }

  /** Open diff view for an agent — refreshes changed files from git */
  async show(agentId: string, projectPath: string): Promise<void> {
    const files = await this.getChangedFiles(projectPath);
    if (files.length === 0) {
      vscode.window.showInformationMessage('No changed files for this agent.');
      return;
    }
    this.states.set(agentId, { agentId, projectPath, files, currentIndex: 0, mode: 'file' });
    await this.openDiffAtIndex(agentId, 0);
    this.emitPosition(agentId);
    this.log.appendLine(`[DIFF ${agentId}] Opened diff view: ${files.length} changed files`);
  }

  /** Navigate: next/prev file or hunk depending on mode */
  async navigate(agentId: string, direction: 'next' | 'prev'): Promise<void> {
    const state = this.states.get(agentId);
    if (!state) return;

    if (state.mode === 'file') {
      const delta = direction === 'next' ? 1 : -1;
      const newIndex = Math.max(0, Math.min(state.files.length - 1, state.currentIndex + delta));
      if (newIndex === state.currentIndex) return;
      state.currentIndex = newIndex;
      await this.openDiffAtIndex(agentId, state.currentIndex);
      this.emitPosition(agentId);
    } else {
      // Hunk mode — use VS Code's built-in next/prev change
      const cmd = direction === 'next'
        ? 'workbench.action.editor.nextChange'
        : 'workbench.action.editor.previousChange';
      await vscode.commands.executeCommand(cmd);
    }
  }

  /** Toggle between file-level and hunk-level scrubbing */
  toggleMode(agentId: string): void {
    const state = this.states.get(agentId);
    if (!state) return;
    state.mode = state.mode === 'file' ? 'hunk' : 'file';
    this.emitPosition(agentId);
    this.log.appendLine(`[DIFF ${agentId}] Mode: ${state.mode}`);
  }

  /** Refresh changed files for an agent */
  async refresh(agentId: string): Promise<void> {
    const state = this.states.get(agentId);
    if (!state) return;
    const files = await this.getChangedFiles(state.projectPath);
    state.files = files;
    state.currentIndex = Math.min(state.currentIndex, Math.max(0, files.length - 1));
    this.emitPosition(agentId);
  }

  /** Check if diff scrubbing is active for an agent */
  isActive(agentId: string): boolean {
    return this.states.has(agentId);
  }

  /** Clean up state when agent is killed */
  remove(agentId: string): void {
    this.states.delete(agentId);
  }

  /** Get all agent IDs that have active diff state */
  getActiveAgentIds(): string[] {
    return [...this.states.keys()];
  }

  // ── Private ──

  private async getChangedFiles(projectPath: string): Promise<ChangedFile[]> {
    try {
      const [unstaged, staged] = await Promise.all([
        execFileAsync('git', ['diff', '--name-status'], { cwd: projectPath }).catch(() => ({ stdout: '' })),
        execFileAsync('git', ['diff', '--name-status', '--cached'], { cwd: projectPath }).catch(() => ({ stdout: '' })),
      ]);
      return this.parseNameStatus(unstaged.stdout + staged.stdout, projectPath);
    } catch {
      return [];
    }
  }

  private parseNameStatus(output: string, projectPath: string): ChangedFile[] {
    const seen = new Set<string>();
    const files: ChangedFile[] = [];
    for (const line of output.split('\n')) {
      const match = line.match(/^([MADRC])\t(.+)$/);
      if (match && !seen.has(match[2])) {
        seen.add(match[2]);
        files.push({
          path: match[2],
          absPath: `${projectPath}/${match[2]}`,
          status: match[1],
        });
      }
    }
    return files;
  }

  private async openDiffAtIndex(agentId: string, index: number): Promise<void> {
    const state = this.states.get(agentId);
    if (!state || index < 0 || index >= state.files.length) return;
    const file = state.files[index];
    const workingUri = vscode.Uri.file(file.absPath);

    try {
      // Use VS Code's built-in git extension to open the diff
      await vscode.commands.executeCommand('git.openChange', workingUri);
    } catch (err: any) {
      this.log.appendLine(`[DIFF ${agentId}] Failed to open diff for ${file.path}: ${err.message}`);
    }
  }

  private emitPosition(agentId: string): void {
    const state = this.states.get(agentId);
    if (!state) return;
    const file = state.files[state.currentIndex];
    this.onPositionChange({
      type: 'diff_position',
      agentId,
      fileIndex: state.currentIndex,
      fileCount: state.files.length,
      fileName: file?.path || '',
      mode: state.mode,
    });
  }
}
