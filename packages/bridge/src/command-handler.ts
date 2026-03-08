import type { AgentDeckClient } from './agent-deck-client.js';
import type { PluginMessage } from './protocol.js';

export class CommandHandler {
  constructor(private client: AgentDeckClient) {}

  async handle(message: PluginMessage): Promise<void> {
    switch (message.type) {
      case 'command':
        await this.handleCommand(message);
        break;
      case 'launch':
        await this.client.createSession(message.projectPath, message.agent, undefined, message.message);
        break;
      case 'open_terminal':
        await this.client.attachTerminal(message.agentId);
        break;
    }
  }

  private async handleCommand(msg: Extract<PluginMessage, { type: 'command' }>): Promise<void> {
    switch (msg.action) {
      case 'approve':
        this.client.sendInput(msg.agentId, 'y\n');
        break;
      case 'reject':
        this.client.sendInput(msg.agentId, 'n\n');
        break;
      case 'pause':
        // Send Ctrl+C to interrupt the agent
        this.client.sendInput(msg.agentId, '\x03');
        break;
      case 'resume':
        // Send empty enter to resume (agent-specific, may need refinement)
        this.client.sendInput(msg.agentId, '\n');
        break;
      case 'kill':
        await this.client.killSession(msg.agentId);
        break;
    }
  }
}
