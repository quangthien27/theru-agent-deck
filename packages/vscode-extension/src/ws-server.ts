import { WebSocketServer, WebSocket } from 'ws';
import type { ServerMessage, ClientMessage, StateUpdate } from './protocol';

export class WSServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private lastState: StateUpdate | null = null;
  private onMessage: ((msg: ClientMessage) => void) | null = null;
  private boundPort = 0;

  /** Start the server on the given port. Resolves with bound port, rejects on EADDRINUSE. */
  start(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({ port });

      server.on('listening', () => {
        this.wss = server;
        this.boundPort = port;
        this.setupConnectionHandler();
        resolve(port);
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        server.close();
        reject(err);
      });
    });
  }

  private setupConnectionHandler(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      // Send current state on connect
      if (this.lastState) {
        ws.send(JSON.stringify(this.lastState));
      }

      ws.on('message', (data) => {
        try {
          const msg: ClientMessage = JSON.parse(data.toString());
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

  getPort(): number {
    return this.boundPort;
  }

  setMessageHandler(handler: (msg: ClientMessage) => void): void {
    this.onMessage = handler;
  }

  broadcast(message: ServerMessage | Record<string, any>): void {
    if ((message as any).type === 'state') {
      this.lastState = message as StateUpdate;
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
