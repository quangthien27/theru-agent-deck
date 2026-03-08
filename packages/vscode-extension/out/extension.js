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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const agent_manager_1 = require("./agent-manager");
const ws_server_1 = require("./ws-server");
const sidebar_provider_1 = require("./sidebar-provider");
const commands_1 = require("./commands");
const WS_PORT = 9999;
let agentManager;
let wsServer;
let sidebarProvider;
let statusBarItem;
function activate(context) {
    const outputChannel = vscode.window.createOutputChannel('AgentDeck');
    context.subscriptions.push(outputChannel);
    try {
        // ── Agent Manager ──────────────────────────────────────
        agentManager = new agent_manager_1.AgentManager(outputChannel);
        // ── Sidebar ────────────────────────────────────────────
        sidebarProvider = new sidebar_provider_1.AgentSidebarProvider();
        const treeView = vscode.window.createTreeView('agentdeck.agents', {
            treeDataProvider: sidebarProvider,
            showCollapseAll: false,
        });
        // ── Status Bar ─────────────────────────────────────────
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
        statusBarItem.command = 'agentdeck.newAgent';
        updateStatusBar([]);
        statusBarItem.show();
        // ── WebSocket Server ───────────────────────────────────
        wsServer = new ws_server_1.WSServer();
        wsServer.start(WS_PORT);
        wsServer.setMessageHandler((msg) => {
            handleClientMessage(msg);
        });
        // ── State broadcast ────────────────────────────────────
        agentManager.on('stateChange', (agents) => {
            sidebarProvider.updateAgents(agents);
            updateStatusBar(agents);
            wsServer.broadcast({ type: 'state', agents });
        });
        agentManager.on('statusChange', (agentId, prev, next) => {
            // Emit events for Logi Plugin haptics
            if (next === 'waiting') {
                wsServer.broadcast({ type: 'event', agentId, event: 'needs_approval' });
            }
            else if (next === 'idle' && prev === 'working') {
                wsServer.broadcast({ type: 'event', agentId, event: 'completed' });
            }
            else if (next === 'error') {
                wsServer.broadcast({ type: 'event', agentId, event: 'error' });
            }
        });
        // ── Commands ───────────────────────────────────────────
        (0, commands_1.registerCommands)(context, agentManager);
        // ── Cleanup ────────────────────────────────────────────
        context.subscriptions.push(treeView, statusBarItem, { dispose: () => agentManager.dispose() }, { dispose: () => wsServer.stop() }, { dispose: () => sidebarProvider.dispose() });
        outputChannel.appendLine(`AgentDeck activated. WebSocket server on :${WS_PORT}`);
    }
    catch (err) {
        outputChannel.appendLine(`[AgentDeck] Activation error: ${err.message}\n${err.stack}`);
        vscode.window.showErrorMessage(`AgentDeck failed to activate: ${err.message}`);
    }
}
function deactivate() {
    agentManager?.dispose();
    wsServer?.stop();
}
// ── Handle messages from Logi Plugin / Simulator ──────────
function handleClientMessage(msg) {
    switch (msg.type) {
        case 'command':
            switch (msg.action) {
                case 'approve':
                    agentManager.approve(msg.agentId);
                    break;
                case 'reject':
                    agentManager.reject(msg.agentId);
                    break;
                case 'pause':
                    agentManager.pause(msg.agentId);
                    break;
                case 'kill':
                    agentManager.kill(msg.agentId);
                    break;
            }
            break;
        case 'launch': {
            // Resolve project path — WebSocket clients may send "." or empty
            let projectPath = msg.projectPath;
            if (!projectPath || projectPath === '.') {
                const folders = vscode.workspace.workspaceFolders;
                projectPath = folders?.[0]?.uri.fsPath || '';
            }
            if (!projectPath) {
                vscode.window.showWarningMessage('AgentDeck: No workspace folder open to launch agent in.');
                break;
            }
            agentManager.launch(msg.agent, projectPath, msg.message);
            break;
        }
        case 'open_terminal':
            agentManager.showTerminal(msg.agentId);
            // Also send focus message back to other clients
            wsServer.broadcast({
                type: 'focus',
                agentId: msg.agentId,
                view: 'terminal',
            });
            break;
    }
}
// ── Status bar ────────────────────────────────────────────
function updateStatusBar(agents) {
    const total = agents.length;
    const waiting = agents.filter(a => a.status === 'waiting').length;
    const working = agents.filter(a => a.status === 'working').length;
    const errors = agents.filter(a => a.status === 'error').length;
    if (total === 0) {
        statusBarItem.text = '$(plug) AgentDeck';
        statusBarItem.tooltip = 'No agents running. Click to launch one.';
        return;
    }
    let parts = [`$(plug) ${total} agent${total > 1 ? 's' : ''}`];
    if (waiting > 0)
        parts.push(`$(bell) ${waiting}`);
    if (working > 0)
        parts.push(`$(sync~spin) ${working}`);
    if (errors > 0)
        parts.push(`$(error) ${errors}`);
    statusBarItem.text = parts.join('  ');
    statusBarItem.tooltip = `AgentDeck: ${total} agents (${working} working, ${waiting} waiting, ${errors} errors)`;
}
//# sourceMappingURL=extension.js.map