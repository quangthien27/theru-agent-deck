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
exports.registerCommands = registerCommands;
const vscode = __importStar(require("vscode"));
const protocol_1 = require("./protocol");
const simulator_webview_1 = require("./simulator-webview");
function registerCommands(context, agentManager) {
    context.subscriptions.push(vscode.commands.registerCommand('agentdeck.newAgent', async () => {
        // Pick agent type
        const agentType = await vscode.window.showQuickPick(protocol_1.SUPPORTED_AGENTS.map(a => ({ label: a, description: `Launch ${a} agent` })), { placeHolder: 'Select agent type' });
        if (!agentType)
            return;
        // Pick project folder
        const folders = vscode.workspace.workspaceFolders;
        let projectPath;
        if (folders && folders.length === 1) {
            projectPath = folders[0].uri.fsPath;
        }
        else if (folders && folders.length > 1) {
            const picked = await vscode.window.showQuickPick(folders.map(f => ({ label: f.name, description: f.uri.fsPath, path: f.uri.fsPath })), { placeHolder: 'Select project folder' });
            if (!picked)
                return;
            projectPath = picked.path;
        }
        else {
            const uri = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                openLabel: 'Select Project Folder',
            });
            if (!uri || uri.length === 0)
                return;
            projectPath = uri[0].fsPath;
        }
        // Optional initial message
        const message = await vscode.window.showInputBox({
            prompt: 'Initial message for the agent (optional)',
            placeHolder: 'e.g., fix the login bug',
        });
        const id = agentManager.launch(agentType.label, projectPath, message || undefined);
        agentManager.showTerminal(id);
    }), vscode.commands.registerCommand('agentdeck.approve', (agentId) => {
        const id = agentId || getWaitingAgentId(agentManager);
        if (id) {
            agentManager.approve(id);
        }
        else {
            vscode.window.showInformationMessage('No agent waiting for approval');
        }
    }), vscode.commands.registerCommand('agentdeck.reject', (agentId) => {
        const id = agentId || getWaitingAgentId(agentManager);
        if (id) {
            agentManager.reject(id);
        }
        else {
            vscode.window.showInformationMessage('No agent waiting for approval');
        }
    }), vscode.commands.registerCommand('agentdeck.kill', async (agentId) => {
        const id = agentId || await pickAgent(agentManager, 'Select agent to kill');
        if (id) {
            agentManager.kill(id);
        }
    }), vscode.commands.registerCommand('agentdeck.showTerminal', (agentId) => {
        if (agentId) {
            agentManager.showTerminal(agentId);
        }
    }), vscode.commands.registerCommand('agentdeck.showDiff', async (agentId) => {
        const id = agentId || getWaitingAgentId(agentManager);
        if (!id) {
            vscode.window.showInformationMessage('No agent with pending approval');
            return;
        }
        // Show the terminal for now — diff viewer will be enhanced later
        agentManager.showTerminal(id);
    }), vscode.commands.registerCommand('agentdeck.openSimulator', () => {
        (0, simulator_webview_1.openSimulatorWebview)(context);
    }));
}
function getWaitingAgentId(agentManager) {
    const agents = agentManager.getAgents();
    const waiting = agents.find(a => a.status === 'waiting');
    return waiting?.id;
}
async function pickAgent(agentManager, placeholder) {
    const agents = agentManager.getAgents();
    if (agents.length === 0) {
        vscode.window.showInformationMessage('No agents running');
        return;
    }
    const picked = await vscode.window.showQuickPick(agents.map(a => ({
        label: `${a.name} (${a.agent})`,
        description: a.status,
        id: a.id,
    })), { placeHolder: placeholder });
    return picked?.id;
}
//# sourceMappingURL=commands.js.map