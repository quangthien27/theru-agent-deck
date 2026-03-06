import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

export interface BridgeConfig {
  agentDeck: {
    host: string;
    port: number;
    bin: string;
  };
  bridge: {
    port: number;
  };
}

const defaults: BridgeConfig = {
  agentDeck: {
    host: '127.0.0.1',
    port: 8420,
    bin: 'agent-deck',
  },
  bridge: {
    port: 9999,
  },
};

export async function loadConfig(): Promise<BridgeConfig> {
  const configPath = join(homedir(), '.agentdeck', 'config.json');
  try {
    const raw = await readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(raw);
    return {
      agentDeck: { ...defaults.agentDeck, ...userConfig.agentDeck },
      bridge: { ...defaults.bridge, ...userConfig.bridge },
    };
  } catch {
    return defaults;
  }
}

export function agentDeckBaseUrl(config: BridgeConfig): string {
  return `http://${config.agentDeck.host}:${config.agentDeck.port}`;
}
