import { WebSocketServer, WebSocket } from 'ws';
import type { BridgeMessage, PluginMessage, StateUpdate } from './protocol.js';

export class PluginWSServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private lastState: StateUpdate | null = null;
  private onMessage: ((msg: PluginMessage) => void) | null = null;

  start(port: number): void {
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      // Send current state on connect
      if (this.lastState) {
        ws.send(JSON.stringify(this.lastState));
      }

      ws.on('message', (data) => {
        try {
          const msg: PluginMessage = JSON.parse(data.toString());
          this.onMessage?.(msg);
        } catch {
          // ignore malformed messages
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });
  }

  setMessageHandler(handler: (msg: PluginMessage) => void): void {
    this.onMessage = handler;
  }

  broadcast(message: BridgeMessage): void {
    if (message.type === 'state') {
      this.lastState = message;
    }

    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  stop(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
  }
}
