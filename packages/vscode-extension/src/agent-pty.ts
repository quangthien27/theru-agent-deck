import * as vscode from 'vscode';
import * as path from 'path';

// Load node-pty from VS Code's bundled modules (avoids native compilation)
let nodePty: any;
try {
  nodePty = require(path.join(vscode.env.appRoot, 'node_modules.asar', 'node-pty'));
} catch {
  try {
    nodePty = require(path.join(vscode.env.appRoot, 'node_modules', 'node-pty'));
  } catch {
    nodePty = null;
  }
}

export interface AgentPtyHandle {
  terminal: vscode.Terminal;
  onData: vscode.Event<string>;
  write(data: string): void;
  kill(): void;
  onExit: vscode.Event<{ exitCode: number; signal?: number }>;
}

export function isNodePtyAvailable(): boolean {
  return nodePty !== null;
}

export function spawnAgentPty(opts: {
  command: string;
  args: string[];
  cwd: string;
  name: string;
  env?: Record<string, string>;
}): AgentPtyHandle {
  const writeEmitter = new vscode.EventEmitter<string>();
  const closeEmitter = new vscode.EventEmitter<number | void>();
  const dataEmitter = new vscode.EventEmitter<string>();
  const exitEmitter = new vscode.EventEmitter<{ exitCode: number; signal?: number }>();

  let ptyProcess: any = null;

  const pseudoterminal: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,

    open(initialDimensions) {
      const cols = initialDimensions?.columns || 120;
      const rows = initialDimensions?.rows || 30;

      ptyProcess = nodePty.spawn(opts.command, opts.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env } as Record<string, string>,
      });

      ptyProcess.onData((data: string) => {
        writeEmitter.fire(data);   // Show in VS Code terminal
        dataEmitter.fire(data);    // Expose to AgentManager for status detection
      });

      ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
        exitEmitter.fire({ exitCode, signal });
        closeEmitter.fire(exitCode);
      });
    },

    close() {
      if (ptyProcess) {
        try { ptyProcess.kill(); } catch {}
        ptyProcess = null;
      }
    },

    handleInput(data: string) {
      if (ptyProcess) {
        ptyProcess.write(data);
      }
    },

    setDimensions(dimensions: vscode.TerminalDimensions) {
      if (ptyProcess) {
        try { ptyProcess.resize(dimensions.columns, dimensions.rows); } catch {}
      }
    },
  };

  const terminal = vscode.window.createTerminal({
    name: opts.name,
    pty: pseudoterminal,
  });

  return {
    terminal,
    onData: dataEmitter.event,
    write(data: string) {
      if (ptyProcess) {
        ptyProcess.write(data);
      }
    },
    kill() {
      if (ptyProcess) {
        try { ptyProcess.kill(); } catch {}
        ptyProcess = null;
      }
      terminal.dispose();
    },
    onExit: exitEmitter.event,
  };
}
