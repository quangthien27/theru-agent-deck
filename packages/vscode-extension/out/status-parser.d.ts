import type { AgentStatus, ApprovalRequest } from './protocol';
export declare function stripAnsi(content: string): string;
export declare function detectStatus(output: string, currentStatus: AgentStatus, agentType?: string): AgentStatus;
export declare function parseApproval(terminalOutput: string): ApprovalRequest | null;
//# sourceMappingURL=status-parser.d.ts.map