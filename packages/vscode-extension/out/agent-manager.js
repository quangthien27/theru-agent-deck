"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentManager = void 0;
const vscode = __importStar(require("vscode"));
const events_1 = require("events");
const protocol_1 = require("./protocol");
const status_parser_1 = require("./status-parser");
class AgentManager extends events_1.EventEmitter {
    agents = new Map();
    terminalToAgent = new Map();
    nextId = 1;
    statusCheckInterval = null;
    disposables = [];
    log;
    constructor(outputChannel) {
        super();
        this.log = outputChannel;
        // Track terminal close
        this.disposables.push(vscode.window.onDidCloseTerminal((terminal) => {
            const agentId = this.terminalToAgent.get(terminal);
            if (agentId) {
                const agent = this.agents.get(agentId);
                if (agent) {
                    agent.status = 'offline';
                    this.emitStateChange();
                }
                this.terminalToAgent.delete(terminal);
                this.agents.delete(agentId);
                this.emitStateChange();
            }
        }));
        // Capture terminal output for status detection
        this.disposables.push(vscode.window.onDidWriteTerminalData((e) => {
            const agentId = this.terminalToAgent.get(e.terminal);
            if (agentId) {
                const agent = this.agents.get(agentId);
                if (agent) {
                    const chunk = e.data;
                    agent.outputBuffer += chunk;
                    if (agent.outputBuffer.length > 8000) {
                        agent.outputBuffer = agent.outputBuffer.slice(-8000);
                    }
                    // Log cleaned preview (strip ANSI, collapse whitespace)
                    const cleaned = (0, status_parser_1.stripAnsi)(chunk).replace(/\s+/g, ' ').trim();
                    if (cleaned.length > 0) {
                        const preview = cleaned.length > 120 ? cleaned.slice(0, 120) + '...' : cleaned;
                        this.log.appendLine(`[DATA ${agentId}] ${preview}`);
                    }
                }
            }
        }));
        this.log.appendLine('[AgentManager] Initialized with onDidWriteTerminalData listener');
        // Periodically re-evaluate status from terminal output
        this.statusCheckInterval = setInterval(() => this.checkStatuses(), 2000);
    }
    getAgents() {
        const result = [];
        let slot = 0;
        for (const agent of this.agents.values()) {
            const approval = agent.status === 'waiting'
                ? (0, status_parser_1.parseApproval)(agent.outputBuffer) ?? undefined
                : undefined;
            result.push({
                id: agent.id,
                slot: slot++,
                name: agent.name,
                agent: agent.agent,
                status: agent.status,
                projectPath: agent.projectPath,
                createdAt: agent.createdAt,
                approval,
            });
        }
        return result;
    }
    getAgent(id) {
        return this.agents.get(id);
    }
    launch(agentType, projectPath, message) {
        const id = `agent-${this.nextId++}`;
        const cmd = (0, protocol_1.agentCommand)(agentType);
        // Build args — launch in interactive mode, optionally with an initial message
        const args = [];
        if (message) {
            if (agentType === 'aider') {
                args.push('--message', message);
            }
            // For claude and others: send message after launch via sendText
        }
        // Generate short name from project path
        const dirName = projectPath.split('/').filter(Boolean).pop() || agentType;
        // Open a normal shell terminal, then send the agent command into it
        const terminal = vscode.window.createTerminal({
            name: `AgentDeck: ${agentType} (${dirName})`,
            cwd: projectPath,
        });
        terminal.show();
        // Build the full command string and send it to the shell
        const fullCmd = [cmd, ...args].map(a => a.includes(' ') ? `"${a}"` : a).join(' ');
        terminal.sendText(fullCmd);
        // If there's an initial message, send it after a short delay to let the agent start
        if (message && agentType !== 'aider') {
            setTimeout(() => {
                terminal.sendText(message);
            }, 3000);
        }
        const agent = {
            id,
            agent: agentType,
            name: dirName.slice(0, 8).toUpperCase(),
            projectPath,
            createdAt: new Date().toISOString(),
            status: 'working',
            terminal,
            outputBuffer: '',
        };
        this.agents.set(id, agent);
        this.terminalToAgent.set(terminal, id);
        this.log.appendLine(`[LAUNCH ${id}] agent=${agentType} cmd="${fullCmd}" cwd=${projectPath}`);
        this.emitStateChange();
        return id;
    }
    approve(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent || agent.status !== 'waiting')
            return false;
        agent.terminal.sendText('y', true);
        agent.status = 'working';
        this.emitStateChange();
        return true;
    }
    reject(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent || agent.status !== 'waiting')
            return false;
        agent.terminal.sendText('n', true);
        agent.status = 'working';
        this.emitStateChange();
        return true;
    }
    pause(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent)
            return false;
        // Send Ctrl+C via sendText with raw escape
        agent.terminal.sendText('\x03', false);
        return true;
    }
    kill(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent)
            return false;
        agent.terminal.dispose();
        this.terminalToAgent.delete(agent.terminal);
        this.agents.delete(agentId);
        this.emitStateChange();
        return true;
    }
    showTerminal(agentId) {
        const agent = this.agents.get(agentId);
        if (agent) {
            agent.terminal.show();
        }
    }
    getTerminalBuffer(agentId) {
        const agent = this.agents.get(agentId);
        return agent?.outputBuffer || '';
    }
    stuckCount = new Map();
    checkStatuses() {
        let changed = false;
        for (const agent of this.agents.values()) {
            const prev = agent.status;
            const bufLen = agent.outputBuffer.length;
            agent.status = (0, status_parser_1.detectStatus)(agent.outputBuffer, agent.status, agent.agent);
            if (agent.status !== prev) {
                changed = true;
                this.stuckCount.set(agent.id, 0);
                this.log.appendLine(`[STATUS ${agent.id}] ${prev} → ${agent.status} (buf: ${bufLen} chars, agent: ${agent.agent})`);
                // Log last 300 chars of stripped buffer for context
                const tail = (0, status_parser_1.stripAnsi)(agent.outputBuffer.slice(-500)).replace(/\s+/g, ' ').trim().slice(-300);
                this.log.appendLine(`[BUFFER ${agent.id}] ...${tail}`);
                this.emit('statusChange', agent.id, prev, agent.status);
            }
            else if (agent.status === 'working' && bufLen > 200) {
                // Log once when an agent has been stuck on "working" for a few cycles
                const count = (this.stuckCount.get(agent.id) || 0) + 1;
                this.stuckCount.set(agent.id, count);
                if (count === 5) {
                    const tail = (0, status_parser_1.stripAnsi)(agent.outputBuffer.slice(-800)).replace(/\s+/g, ' ').trim().slice(-500);
                    this.log.appendLine(`[STUCK ${agent.id}] still working after ${count} checks (agent: ${agent.agent}, buf: ${bufLen})`);
                    this.log.appendLine(`[STUCK ${agent.id}] tail: ${tail}`);
                }
            }
        }
        if (changed) {
            this.emitStateChange();
        }
    }
    emitStateChange() {
        this.emit('stateChange', this.getAgents());
    }
    dispose() {
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
        }
        for (const d of this.disposables) {
            d.dispose();
        }
        for (const agent of this.agents.values()) {
            agent.terminal.dispose();
        }
        this.agents.clear();
        this.terminalToAgent.clear();
    }
}
exports.AgentManager = AgentManager;
//# sourceMappingURL=agent-manager.js.map