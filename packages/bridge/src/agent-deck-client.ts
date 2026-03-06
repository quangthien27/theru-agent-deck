import { EventEmitter } from 'events';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { EventSource } from 'eventsource';
import WebSocket from 'ws';
import type { MenuSnapshot } from './protocol.js';

const exec = promisify(execCb);

export interface AgentDeckClientOptions {
  baseUrl: string;
  bin: string;
}

export class AgentDeckClient extends EventEmitter {
  private eventSource: EventSource | null = null;
  private terminalSockets = new Map<string, WebSocket>();
  private terminalBuffers = new Map<string, string>();
  private readonly baseUrl: string;
  private readonly bin: string;

  constructor(options: AgentDeckClientOptions) {
    super();
    this.baseUrl = options.baseUrl;
    this.bin = options.bin;
  }

  // ── Health check ──────────────────────────────────────────

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/healthz`);
      if (!res.ok) return false;
      const data = await res.json() as { ok: boolean };
      return data.ok === true;
    } catch {
      return false;
    }
  }

  async waitForReady(timeoutMs = 5000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.isHealthy()) return true;
      await new Promise(r => setTimeout(r, 300));
    }
    return false;
  }

  // ── SSE: stream session state ─────────────────────────────

  connectSSE(): void {
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.eventSource = new EventSource(`${this.baseUrl}/events/menu`);

    this.eventSource.addEventListener('menu', (event: any) => {
      try {
        const snapshot: MenuSnapshot = JSON.parse(event.data);
        this.emit('snapshot', snapshot);
      } catch (err) {
        this.emit('error', new Error(`Failed to parse SSE menu event: ${err}`));
      }
    });

    this.eventSource.onerror = (err: any) => {
      this.emit('error', new Error(`SSE connection error: ${err.message || 'unknown'}`));
    };
  }

  disconnectSSE(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  // ── REST: fetch state on demand ───────────────────────────

  async getMenu(): Promise<MenuSnapshot> {
    const res = await fetch(`${this.baseUrl}/api/menu`);
    if (!res.ok) throw new Error(`GET /api/menu failed: ${res.status}`);
    return res.json() as Promise<MenuSnapshot>;
  }

  async getSession(sessionId: string) {
    const res = await fetch(`${this.baseUrl}/api/session/${sessionId}`);
    if (!res.ok) throw new Error(`GET /api/session/${sessionId} failed: ${res.status}`);
    return res.json();
  }

  // ── WebSocket: terminal I/O ───────────────────────────────

  connectTerminal(sessionId: string): WebSocket {
    const existing = this.terminalSockets.get(sessionId);
    if (existing && existing.readyState === WebSocket.OPEN) {
      return existing;
    }

    const wsUrl = `${this.baseUrl.replace('http', 'ws')}/ws/session/${sessionId}`;
    const ws = new WebSocket(wsUrl);

    // Collect terminal output in a rolling buffer for approval parsing
    ws.on('message', (data: Buffer | string, isBinary: boolean) => {
      if (isBinary) {
        const text = data.toString('utf-8');
        const existing = this.terminalBuffers.get(sessionId) || '';
        // Keep last 4000 chars
        const updated = (existing + text).slice(-4000);
        this.terminalBuffers.set(sessionId, updated);
        this.emit('terminal_output', sessionId, text);
      } else {
        // JSON status/error message
        try {
          const msg = JSON.parse(data.toString());
          this.emit('terminal_status', sessionId, msg);
        } catch { /* ignore parse errors */ }
      }
    });

    ws.on('close', () => {
      this.terminalSockets.delete(sessionId);
      this.terminalBuffers.delete(sessionId);
    });

    ws.on('error', (err) => {
      this.emit('error', new Error(`Terminal WS error for ${sessionId}: ${err.message}`));
    });

    this.terminalSockets.set(sessionId, ws);
    return ws;
  }

  sendInput(sessionId: string, text: string): boolean {
    const ws = this.terminalSockets.get(sessionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: 'input', data: text }));
    return true;
  }

  getTerminalBuffer(sessionId: string): string {
    return this.terminalBuffers.get(sessionId) || '';
  }

  disconnectTerminal(sessionId: string): void {
    const ws = this.terminalSockets.get(sessionId);
    if (ws) {
      ws.close();
      this.terminalSockets.delete(sessionId);
      this.terminalBuffers.delete(sessionId);
    }
  }

  // ── CLI: session management ───────────────────────────────

  async createSession(projectPath: string, agent: string, title?: string): Promise<string> {
    const args = [`add`, `"${projectPath}"`, `-c`, agent];
    if (title) args.push(`-title`, `"${title}"`);
    const { stdout } = await exec(`${this.bin} ${args.join(' ')}`);
    return stdout.trim();
  }

  async killSession(sessionId: string): Promise<void> {
    await exec(`${this.bin} session kill "${sessionId}"`);
  }

  async forkSession(sessionId: string): Promise<string> {
    const { stdout } = await exec(`${this.bin} session fork "${sessionId}"`);
    return stdout.trim();
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    await exec(`${this.bin} session send "${sessionId}" "${message.replace(/"/g, '\\"')}" -q`);
  }

  async attachTerminal(sessionId: string): Promise<void> {
    // This opens a tmux window — non-blocking, spawns a new terminal
    const { stdout } = await exec(`${this.bin} attach "${sessionId}" 2>&1 || true`);
    // attach may fail if no terminal is available, that's ok
  }

  // ── Cleanup ───────────────────────────────────────────────

  destroy(): void {
    this.disconnectSSE();
    for (const [id] of this.terminalSockets) {
      this.disconnectTerminal(id);
    }
    this.removeAllListeners();
  }
}
