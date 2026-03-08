import type { ServerMessage, ClientMessage } from './protocol';
export declare class WSServer {
    private wss;
    private clients;
    private lastState;
    private onMessage;
    start(port: number): void;
    setMessageHandler(handler: (msg: ClientMessage) => void): void;
    broadcast(message: ServerMessage): void;
    getClientCount(): number;
    stop(): void;
}
//# sourceMappingURL=ws-server.d.ts.map