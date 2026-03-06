import { describe, expect, test } from 'bun:test';
import { mapSnapshot, detectTransitions } from '../src/state-mapper.js';
import type { MenuSnapshot, StateUpdate } from '../src/protocol.js';

function makeSnapshot(sessions: Array<{ id: string; title: string; tool: string; status: string; projectPath?: string }>): MenuSnapshot {
  return {
    profile: 'default',
    generatedAt: new Date().toISOString(),
    totalGroups: 1,
    totalSessions: sessions.length,
    items: sessions.map((s, i) => ({
      index: i,
      type: 'session' as const,
      level: 1,
      path: `/${s.title}`,
      isLastInGroup: i === sessions.length - 1,
      isSubSession: false,
      session: {
        id: s.id,
        title: s.title,
        tool: s.tool,
        status: s.status,
        groupPath: '/default',
        projectPath: s.projectPath || '/tmp/test',
        parentSessionId: '',
        order: i,
        tmuxSession: `agentdeck_${s.title}_abc123`,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      },
    })),
  };
}

describe('mapSnapshot', () => {
  test('maps empty snapshot', () => {
    const snapshot = makeSnapshot([]);
    const result = mapSnapshot(snapshot);
    expect(result.type).toBe('state');
    expect(result.agents).toHaveLength(0);
  });

  test('maps sessions to agents with correct fields', () => {
    const snapshot = makeSnapshot([
      { id: 'a1', title: 'Auth Fix', tool: 'claude', status: 'running' },
      { id: 'a2', title: 'API Tests', tool: 'gemini', status: 'idle' },
    ]);
    const result = mapSnapshot(snapshot);

    expect(result.agents).toHaveLength(2);
    expect(result.agents[0]).toMatchObject({
      id: 'a1',
      slot: 0,
      name: 'Auth Fix',
      agent: 'claude',
      status: 'working',
    });
    expect(result.agents[1]).toMatchObject({
      id: 'a2',
      slot: 1,
      name: 'API Tests',
      agent: 'gemini',
      status: 'idle',
    });
  });

  test('maps status correctly', () => {
    const snapshot = makeSnapshot([
      { id: '1', title: 'A', tool: 'claude', status: 'running' },
      { id: '2', title: 'B', tool: 'claude', status: 'waiting' },
      { id: '3', title: 'C', tool: 'claude', status: 'idle' },
      { id: '4', title: 'D', tool: 'claude', status: 'error' },
      { id: '5', title: 'E', tool: 'claude', status: 'unknown' },
    ]);
    const result = mapSnapshot(snapshot);

    expect(result.agents[0].status).toBe('working');
    expect(result.agents[1].status).toBe('waiting');
    expect(result.agents[2].status).toBe('idle');
    expect(result.agents[3].status).toBe('error');
    expect(result.agents[4].status).toBe('offline');
  });

  test('limits to 6 agents', () => {
    const sessions = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      title: `Session ${i}`,
      tool: 'claude',
      status: 'idle',
    }));
    const snapshot = makeSnapshot(sessions);
    const result = mapSnapshot(snapshot);

    expect(result.agents).toHaveLength(6);
  });

  test('skips group items', () => {
    const snapshot: MenuSnapshot = {
      profile: 'default',
      generatedAt: new Date().toISOString(),
      totalGroups: 1,
      totalSessions: 1,
      items: [
        {
          index: 0,
          type: 'group',
          level: 0,
          path: '/projects',
          isLastInGroup: false,
          isSubSession: false,
          group: { name: 'Projects', path: '/projects', expanded: true, order: 0, sessionCount: 1 },
        },
        {
          index: 1,
          type: 'session',
          level: 1,
          path: '/projects/test',
          isLastInGroup: true,
          isSubSession: false,
          session: {
            id: 's1',
            title: 'Test',
            tool: 'claude',
            status: 'idle',
            groupPath: '/projects',
            projectPath: '/tmp/test',
            parentSessionId: '',
            order: 0,
            tmuxSession: 'agentdeck_test_abc',
            createdAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString(),
          },
        },
      ],
    };

    const result = mapSnapshot(snapshot);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe('Test');
  });
});

describe('detectTransitions', () => {
  test('returns empty for first state', () => {
    const state: StateUpdate = {
      type: 'state',
      agents: [{ id: 'a1', slot: 0, name: 'T', agent: 'claude', status: 'working', projectPath: '/tmp', createdAt: '' }],
    };
    expect(detectTransitions(null, state)).toHaveLength(0);
  });

  test('detects needs_approval when status changes to waiting', () => {
    const prev: StateUpdate = {
      type: 'state',
      agents: [{ id: 'a1', slot: 0, name: 'T', agent: 'claude', status: 'working', projectPath: '/tmp', createdAt: '' }],
    };
    const next: StateUpdate = {
      type: 'state',
      agents: [{ id: 'a1', slot: 0, name: 'T', agent: 'claude', status: 'waiting', projectPath: '/tmp', createdAt: '' }],
    };

    const events = detectTransitions(prev, next);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ agentId: 'a1', event: 'needs_approval' });
  });

  test('detects completed when status goes from working to idle', () => {
    const prev: StateUpdate = {
      type: 'state',
      agents: [{ id: 'a1', slot: 0, name: 'T', agent: 'claude', status: 'working', projectPath: '/tmp', createdAt: '' }],
    };
    const next: StateUpdate = {
      type: 'state',
      agents: [{ id: 'a1', slot: 0, name: 'T', agent: 'claude', status: 'idle', projectPath: '/tmp', createdAt: '' }],
    };

    const events = detectTransitions(prev, next);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ agentId: 'a1', event: 'completed' });
  });

  test('detects error transition', () => {
    const prev: StateUpdate = {
      type: 'state',
      agents: [{ id: 'a1', slot: 0, name: 'T', agent: 'claude', status: 'working', projectPath: '/tmp', createdAt: '' }],
    };
    const next: StateUpdate = {
      type: 'state',
      agents: [{ id: 'a1', slot: 0, name: 'T', agent: 'claude', status: 'error', projectPath: '/tmp', createdAt: '' }],
    };

    const events = detectTransitions(prev, next);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ agentId: 'a1', event: 'error' });
  });

  test('no events when status unchanged', () => {
    const state: StateUpdate = {
      type: 'state',
      agents: [{ id: 'a1', slot: 0, name: 'T', agent: 'claude', status: 'working', projectPath: '/tmp', createdAt: '' }],
    };
    expect(detectTransitions(state, state)).toHaveLength(0);
  });

  test('handles multiple agents with mixed transitions', () => {
    const prev: StateUpdate = {
      type: 'state',
      agents: [
        { id: 'a1', slot: 0, name: 'A', agent: 'claude', status: 'working', projectPath: '/tmp', createdAt: '' },
        { id: 'a2', slot: 1, name: 'B', agent: 'gemini', status: 'working', projectPath: '/tmp', createdAt: '' },
        { id: 'a3', slot: 2, name: 'C', agent: 'claude', status: 'idle', projectPath: '/tmp', createdAt: '' },
      ],
    };
    const next: StateUpdate = {
      type: 'state',
      agents: [
        { id: 'a1', slot: 0, name: 'A', agent: 'claude', status: 'waiting', projectPath: '/tmp', createdAt: '' },
        { id: 'a2', slot: 1, name: 'B', agent: 'gemini', status: 'idle', projectPath: '/tmp', createdAt: '' },
        { id: 'a3', slot: 2, name: 'C', agent: 'claude', status: 'idle', projectPath: '/tmp', createdAt: '' },
      ],
    };

    const events = detectTransitions(prev, next);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ agentId: 'a1', event: 'needs_approval' });
    expect(events[1]).toMatchObject({ agentId: 'a2', event: 'completed' });
  });
});
