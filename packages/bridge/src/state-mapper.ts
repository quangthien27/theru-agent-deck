import type {
  MenuSnapshot,
  MenuSession,
  AgentSession,
  StateUpdate,
  AgentEvent,
  PluginStatus,
} from './protocol.js';

export function mapSnapshot(snapshot: MenuSnapshot): StateUpdate {
  const sessions = snapshot.items
    .filter(item => item.type === 'session' && item.session)
    .map((item, index) => mapSession(item.session!, index));

  return {
    type: 'state',
    agents: sessions.slice(0, 6), // max 6 slots on keypad
  };
}

function mapSession(session: MenuSession, slot: number): AgentSession {
  return {
    id: session.id,
    slot,
    name: session.title,
    agent: session.tool,
    status: mapStatus(session.status),
    projectPath: session.projectPath,
    createdAt: session.createdAt,
  };
}

function mapStatus(adStatus: string): PluginStatus {
  switch (adStatus) {
    case 'running': return 'working';
    case 'waiting': return 'waiting';
    case 'idle': return 'idle';
    case 'error': return 'error';
    default: return 'offline';
  }
}

/**
 * Compare two StateUpdates and emit events for status transitions.
 * Returns events that should trigger haptics on the plugin side.
 */
export function detectTransitions(
  prev: StateUpdate | null,
  next: StateUpdate
): AgentEvent[] {
  if (!prev) return [];

  const events: AgentEvent[] = [];
  const prevMap = new Map(prev.agents.map(a => [a.id, a]));

  for (const agent of next.agents) {
    const prevAgent = prevMap.get(agent.id);
    if (!prevAgent) continue;

    if (prevAgent.status !== agent.status) {
      if (agent.status === 'waiting') {
        events.push({ type: 'event', agentId: agent.id, event: 'needs_approval' });
      } else if (agent.status === 'idle' && prevAgent.status === 'working') {
        events.push({ type: 'event', agentId: agent.id, event: 'completed' });
      } else if (agent.status === 'error') {
        events.push({ type: 'event', agentId: agent.id, event: 'error' });
      }
    }
  }

  return events;
}
