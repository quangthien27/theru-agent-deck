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
exports.AgentSidebarProvider = void 0;
const vscode = __importStar(require("vscode"));
class AgentSidebarProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    agents = [];
    updateAgents(agents) {
        this.agents = agents;
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        if (this.agents.length === 0) {
            return [new AgentTreeItem('No agents running', 'none', '', vscode.TreeItemCollapsibleState.None)];
        }
        return this.agents.map(agent => new AgentTreeItem(`${statusIcon(agent.status)} ${agent.name}`, agent.status, agent.id, vscode.TreeItemCollapsibleState.None, agent));
    }
    dispose() {
        this._onDidChangeTreeData.dispose();
    }
}
exports.AgentSidebarProvider = AgentSidebarProvider;
class AgentTreeItem extends vscode.TreeItem {
    status;
    agentId;
    constructor(label, status, agentId, collapsibleState, agent) {
        super(label, collapsibleState);
        this.status = status;
        this.agentId = agentId;
        if (agent) {
            this.description = `${agent.agent} · ${agent.projectPath.split('/').pop()}`;
            this.tooltip = new vscode.MarkdownString(`**${agent.name}** (${agent.agent})\n\n` +
                `Status: ${agent.status}\n\n` +
                `Project: ${agent.projectPath}\n\n` +
                (agent.approval ? `⚠ ${agent.approval.summary}` : ''));
            this.contextValue = `agent-${agent.status}`;
            // Click to show terminal
            this.command = {
                command: 'agentdeck.showTerminal',
                title: 'Show Terminal',
                arguments: [agent.id],
            };
        }
        else {
            this.contextValue = 'no-agents';
        }
    }
}
function statusIcon(status) {
    switch (status) {
        case 'working': return '$(sync~spin)';
        case 'waiting': return '$(bell)';
        case 'idle': return '$(circle-outline)';
        case 'error': return '$(error)';
        case 'offline': return '$(circle-slash)';
    }
}
//# sourceMappingURL=sidebar-provider.js.map