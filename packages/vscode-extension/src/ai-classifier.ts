import * as http from 'http';
import type { AgentStatus } from './protocol';

interface ClassifyResult {
  status: AgentStatus;
  confidence: number;
}

const VALID_STATUSES = new Set<AgentStatus>(['idle', 'working', 'waiting', 'error']);

const PROMPT_TEMPLATE = `Classify this terminal output from a coding agent. Reply with ONLY one word: idle, working, waiting, or error.

- idle: agent is ready for new input (shows a prompt like > or aider>)
- working: agent is actively processing (spinners, "thinking", generating)
- waiting: agent needs user approval or confirmation (yes/no prompt, permission dialog)
- error: agent encountered an error

Terminal output (last 500 chars):
---
{OUTPUT}
---

Status:`;

export class OllamaClassifier {
  private url: string;
  private model: string;
  private log: { appendLine(value: string): void };
  private lastCallPerAgent = new Map<string, number>();
  private debounceMs = 3000;
  private timeoutMs = 2000;

  constructor(url: string, model: string, log: { appendLine(value: string): void }) {
    this.url = url;
    this.model = model;
    this.log = log;
    this.log.appendLine(`Initialized: ${url} model=${model}`);
  }

  async classify(strippedOutput: string, agentType: string, agentId: string): Promise<ClassifyResult | null> {
    // Debounce: skip if called for same agent within 3 seconds
    const now = Date.now();
    const lastCall = this.lastCallPerAgent.get(agentId);
    if (lastCall && now - lastCall < this.debounceMs) {
      return null;
    }
    this.lastCallPerAgent.set(agentId, now);

    // Take last 500 chars of stripped output
    const tail = strippedOutput.slice(-500);
    if (tail.trim().length < 10) return null;

    const prompt = PROMPT_TEMPLATE.replace('{OUTPUT}', tail);

    try {
      const response = await this.callOllama(prompt);
      if (!response) return null;

      return this.parseResponse(response);
    } catch (err: any) {
      // Silent fail — don't log connection refused (Ollama not running is expected)
      if (err.code !== 'ECONNREFUSED') {
        this.log.appendLine(`Error: ${err.message}`);
      }
      return null;
    }
  }

  private callOllama(prompt: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(this.url);
      const postData = JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature: 0,
          num_predict: 10, // We only need one word
        },
      });

      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 11434,
          path: '/api/generate',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
          timeout: this.timeoutMs,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              resolve(json.response || null);
            } catch {
              resolve(null);
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  private parseResponse(response: string): ClassifyResult | null {
    // Extract the first valid status word from response
    const lower = response.toLowerCase().trim();
    for (const status of VALID_STATUSES) {
      if (lower.startsWith(status) || lower === status) {
        return { status, confidence: lower === status ? 0.9 : 0.7 };
      }
    }

    // Try to find any valid status word in the response
    for (const status of VALID_STATUSES) {
      if (lower.includes(status)) {
        return { status, confidence: 0.5 };
      }
    }

    return null;
  }

  dispose(): void {
    this.lastCallPerAgent.clear();
  }
}
