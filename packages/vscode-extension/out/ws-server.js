"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WSServer = void 0;
const ws_1 = require("ws");
class WSServer {
    wss = null;
    clients = new Set();
    lastState = null;
    onMessage = null;
    start(port) {
        this.wss = new ws_1.WebSocketServer({ port });
        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            // Send current state on connect
            if (this.lastState) {
                ws.send(JSON.stringify(this.lastState));
            }
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    this.onMessage?.(msg);
                }
                catch {
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
    setMessageHandler(handler) {
        this.onMessage = handler;
    }
    broadcast(message) {
        if (message.type === 'state') {
            this.lastState = message;
        }
        const data = JSON.stringify(message);
        for (const client of this.clients) {
            if (client.readyState === ws_1.WebSocket.OPEN) {
                client.send(data);
            }
        }
    }
    getClientCount() {
        return this.clients.size;
    }
    stop() {
        for (const client of this.clients) {
            client.close();
        }
        this.clients.clear();
        this.wss?.close();
        this.wss = null;
    }
}
exports.WSServer = WSServer;
//# sourceMappingURL=ws-server.js.map