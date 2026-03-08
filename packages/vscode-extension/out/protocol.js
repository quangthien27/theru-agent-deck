"use strict";
// ============================================================
// WebSocket protocol: Extension ↔ Logi Plugin / Simulator
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_AGENTS = void 0;
exports.agentCommand = agentCommand;
exports.SUPPORTED_AGENTS = ['claude', 'gemini', 'aider', 'codex', 'opencode'];
function agentCommand(agent) {
    switch (agent) {
        case 'claude': return 'claude';
        case 'gemini': return 'gemini';
        case 'aider': return 'aider';
        case 'codex': return 'codex';
        case 'opencode': return 'opencode';
    }
}
//# sourceMappingURL=protocol.js.map