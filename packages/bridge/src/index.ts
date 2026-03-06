import { AgentDeckClient } from './agent-deck-client.js';
import { CommandHandler } from './command-handler.js';
import { mapSnapshot, detectTransitions } from './state-mapper.js';
import { parseApproval } from './approval-parser.js';
import { PluginWSServer } from './ws-server.js';
import { loadConfig, agentDeckBaseUrl } from './config.js';
import type { MenuSnapshot, StateUpdate } from './protocol.js';

async function main() {
  const config = await loadConfig();
  const baseUrl = agentDeckBaseUrl(config);

  console.log(`[bridge] Starting AgentDeck Bridge...`);
  console.log(`[bridge] Agent Deck: ${baseUrl}`);
  console.log(`[bridge] Plugin WS: :${config.bridge.port}`);

  // ── Initialize components ─────────────────────────────────

  const adClient = new AgentDeckClient({
    baseUrl,
    bin: config.agentDeck.bin,
  });

  const commandHandler = new CommandHandler(adClient);
  const wsServer = new PluginWSServer();

  // ── Wait for Agent Deck ───────────────────────────────────

  console.log(`[bridge] Waiting for Agent Deck on ${baseUrl}...`);
  const ready = await adClient.waitForReady(10000);
  if (!ready) {
    console.error(`[bridge] Agent Deck not responding at ${baseUrl}. Is it running?`);
    console.error(`[bridge] Start it with: agent-deck web --listen ${config.agentDeck.host}:${config.agentDeck.port}`);
    process.exit(1);
  }
  console.log(`[bridge] Agent Deck is ready.`);

  // ── Start plugin WebSocket server ─────────────────────────

  wsServer.start(config.bridge.port);
  console.log(`[bridge] Plugin WebSocket server listening on :${config.bridge.port}`);

  // ── Handle messages from plugin ───────────────────────────

  wsServer.setMessageHandler(async (msg) => {
    try {
      // For approve/reject, ensure terminal WS is connected first
      if (msg.type === 'command' && (msg.action === 'approve' || msg.action === 'reject' || msg.action === 'pause')) {
        adClient.connectTerminal(msg.agentId);
        // Small delay to let WS connect
        await new Promise(r => setTimeout(r, 200));
      }
      await commandHandler.handle(msg);
    } catch (err) {
      console.error(`[bridge] Error handling command:`, err);
    }
  });

  // ── Subscribe to Agent Deck state via SSE ─────────────────

  let prevState: StateUpdate | null = null;

  adClient.on('snapshot', async (snapshot: MenuSnapshot) => {
    const state = mapSnapshot(snapshot);

    // Detect transitions and emit haptic events
    const events = detectTransitions(prevState, state);
    for (const event of events) {
      wsServer.broadcast(event);

      // When an agent starts waiting, connect terminal WS to read approval context
      if (event.event === 'needs_approval') {
        const ws = adClient.connectTerminal(event.agentId);
        // Wait a bit for terminal data to arrive, then parse
        setTimeout(() => {
          const buffer = adClient.getTerminalBuffer(event.agentId);
          const approval = parseApproval(buffer);
          if (approval) {
            const agent = state.agents.find(a => a.id === event.agentId);
            if (agent) {
              agent.approval = approval;
              wsServer.broadcast(state);
            }
          }
        }, 500);
      }
    }

    prevState = state;
    wsServer.broadcast(state);
  });

  adClient.on('error', (err: Error) => {
    console.error(`[bridge] Agent Deck client error:`, err.message);
  });

  // Fetch initial state, then start SSE stream
  try {
    const initialSnapshot = await adClient.getMenu();
    const initialState = mapSnapshot(initialSnapshot);
    prevState = initialState;
    wsServer.broadcast(initialState);
    console.log(`[bridge] Initial state: ${initialState.agents.length} agent(s)`);
  } catch (err) {
    console.error(`[bridge] Failed to fetch initial state:`, err);
  }

  adClient.connectSSE();
  console.log(`[bridge] SSE connected. Streaming state updates.`);

  // ── Graceful shutdown ─────────────────────────────────────

  const shutdown = () => {
    console.log(`[bridge] Shutting down...`);
    adClient.destroy();
    wsServer.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`[bridge] Ready. Waiting for plugin connections on :${config.bridge.port}`);
}

main().catch((err) => {
  console.error(`[bridge] Fatal error:`, err);
  process.exit(1);
});
