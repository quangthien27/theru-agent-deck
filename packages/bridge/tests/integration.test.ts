import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { AgentDeckClient } from '../src/agent-deck-client.js';
import { mapSnapshot, detectTransitions } from '../src/state-mapper.js';
import { CommandHandler } from '../src/command-handler.js';
import { PluginWSServer } from '../src/ws-server.js';
import type { MenuSnapshot } from '../src/protocol.js';

// ── Mock Agent Deck server ──────────────────────────────────

const MOCK_PORT = 18420;
const BRIDGE_PORT = 19999;

const mockSnapshot: MenuSnapshot = {
  profile: 'default',
  generatedAt: new Date().toISOString(),
  totalGroups: 1,
  totalSessions: 2,
  items: [
    {
      index: 0,
      type: 'session',
      level: 0,
      path: '/auth-fix',
      isLastInGroup: false,
      isSubSession: false,
      session: {
        id: 'sess-001',
        title: 'Auth Fix',
        tool: 'claude',
        status: 'running',
        groupPath: '/default',
        projectPath: '/tmp/myproject',
        parentSessionId: '',
        order: 0,
        tmuxSession: 'agentdeck_authfix_abc',
        createdAt: '2026-03-06T10:00:00Z',
        lastAccessedAt: '2026-03-06T12:00:00Z',
      },
    },
    {
      index: 1,
      type: 'session',
      level: 0,
      path: '/api-tests',
      isLastInGroup: true,
      isSubSession: false,
      session: {
        id: 'sess-002',
        title: 'API Tests',
        tool: 'gemini',
        status: 'waiting',
        groupPath: '/default',
        projectPath: '/tmp/api',
        parentSessionId: '',
        order: 1,
        tmuxSession: 'agentdeck_apitests_def',
        createdAt: '2026-03-06T11:00:00Z',
        lastAccessedAt: '2026-03-06T12:00:00Z',
      },
    },
  ],
};

let mockServer: http.Server;
let mockWss: WebSocketServer;
let lastWsInput: string | null = null;

function startMockAgentDeck(): Promise<void> {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, profile: 'default', readOnly: false, time: new Date().toISOString() }));
      } else if (req.url === '/api/menu') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockSnapshot));
      } else if (req.url?.startsWith('/api/session/')) {
        const id = req.url.split('/').pop();
        const item = mockSnapshot.items.find(i => i.session?.id === id);
        if (item) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ session: item.session, index: item.index }));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'session not found' } }));
        }
      } else if (req.url === '/events/menu') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        // Send initial snapshot
        res.write(`event: menu\ndata: ${JSON.stringify(mockSnapshot)}\n\n`);
        // Keep connection open (SSE)
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    // WebSocket for terminal sessions
    mockWss = new WebSocketServer({ noServer: true });
    mockWss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'status', event: 'connected', time: new Date().toISOString() }));
      ws.send(JSON.stringify({ type: 'status', event: 'ready', time: new Date().toISOString() }));

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'input') {
          lastWsInput = msg.data;
        }
      });
    });

    mockServer.on('upgrade', (req, socket, head) => {
      if (req.url?.startsWith('/ws/session/')) {
        mockWss.handleUpgrade(req, socket, head, (ws) => {
          mockWss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });

    mockServer.listen(MOCK_PORT, '127.0.0.1', () => resolve());
  });
}

function stopMockAgentDeck(): Promise<void> {
  return new Promise((resolve) => {
    mockWss.close();
    mockServer.close(() => resolve());
  });
}

// ── Tests ───────────────────────────────────────────────────

describe('Integration: Bridge with mock Agent Deck', () => {
  let adClient: AgentDeckClient;

  beforeAll(async () => {
    await startMockAgentDeck();
    adClient = new AgentDeckClient({
      baseUrl: `http://127.0.0.1:${MOCK_PORT}`,
      bin: 'echo',  // dummy — CLI calls won't actually run agent-deck
    });
  });

  afterAll(async () => {
    adClient.destroy();
    await stopMockAgentDeck();
  });

  test('health check succeeds', async () => {
    const healthy = await adClient.isHealthy();
    expect(healthy).toBe(true);
  });

  test('waitForReady succeeds quickly', async () => {
    const ready = await adClient.waitForReady(2000);
    expect(ready).toBe(true);
  });

  test('getMenu returns snapshot', async () => {
    const snapshot = await adClient.getMenu();
    expect(snapshot.totalSessions).toBe(2);
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[0].session?.title).toBe('Auth Fix');
  });

  test('getSession returns session details', async () => {
    const data = await adClient.getSession('sess-001') as any;
    expect(data.session.title).toBe('Auth Fix');
    expect(data.session.tool).toBe('claude');
  });

  test('getSession returns 404 for unknown id', async () => {
    try {
      await adClient.getSession('nonexistent');
      expect(true).toBe(false); // should not reach
    } catch (err: any) {
      expect(err.message).toContain('404');
    }
  });

  test('mapSnapshot produces correct plugin state', async () => {
    const snapshot = await adClient.getMenu();
    const state = mapSnapshot(snapshot);

    expect(state.type).toBe('state');
    expect(state.agents).toHaveLength(2);
    expect(state.agents[0]).toMatchObject({
      id: 'sess-001',
      name: 'Auth Fix',
      agent: 'claude',
      status: 'working',
    });
    expect(state.agents[1]).toMatchObject({
      id: 'sess-002',
      name: 'API Tests',
      agent: 'gemini',
      status: 'waiting',
    });
  });

  test('terminal WebSocket connects and sends input', async () => {
    lastWsInput = null;

    const ws = adClient.connectTerminal('sess-001');
    // Wait for connection
    await new Promise<void>((resolve) => {
      ws.on('open', () => resolve());
      if (ws.readyState === WebSocket.OPEN) resolve();
    });

    adClient.sendInput('sess-001', 'y\n');

    // Wait for message to arrive at mock server
    await new Promise(r => setTimeout(r, 100));
    expect(lastWsInput).toBe('y\n');

    adClient.disconnectTerminal('sess-001');
  });
});

describe('Integration: Plugin WebSocket server', () => {
  let wsServer: PluginWSServer;

  beforeAll(() => {
    wsServer = new PluginWSServer();
    wsServer.start(BRIDGE_PORT);
  });

  afterAll(() => {
    wsServer.stop();
  });

  test('client receives state on connect', async () => {
    // Broadcast a state first
    wsServer.broadcast({
      type: 'state',
      agents: [
        { id: 'a1', slot: 0, name: 'Test', agent: 'claude', status: 'idle', projectPath: '/tmp', createdAt: '' },
      ],
    });

    // Connect a client
    const received = await new Promise<any>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`);
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()));
        ws.close();
      });
    });

    expect(received.type).toBe('state');
    expect(received.agents[0].name).toBe('Test');
  });

  test('server receives commands from client', async () => {
    const received = await new Promise<any>((resolve) => {
      wsServer.setMessageHandler((msg) => resolve(msg));

      const ws = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`);
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'command',
          agentId: 'a1',
          action: 'approve',
        }));
        ws.close();
      });
    });

    expect(received.type).toBe('command');
    expect(received.agentId).toBe('a1');
    expect(received.action).toBe('approve');
  });

  test('broadcasts events to multiple clients', async () => {
    const results: any[] = [];

    // Connect two clients
    const ws1 = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`);

    await Promise.all([
      new Promise<void>(r => ws1.on('open', r)),
      new Promise<void>(r => ws2.on('open', r)),
    ]);

    // Skip initial state messages
    await new Promise(r => setTimeout(r, 50));

    const p1 = new Promise<any>(r => ws1.on('message', (d) => r(JSON.parse(d.toString()))));
    const p2 = new Promise<any>(r => ws2.on('message', (d) => r(JSON.parse(d.toString()))));

    wsServer.broadcast({ type: 'event', agentId: 'a1', event: 'needs_approval' });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.event).toBe('needs_approval');
    expect(r2.event).toBe('needs_approval');

    ws1.close();
    ws2.close();
  });
});
