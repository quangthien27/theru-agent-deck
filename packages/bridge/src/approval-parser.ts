import type { ApprovalRequest } from './protocol.js';

/**
 * Parse approval context from raw terminal output.
 * Called when a session's status is "waiting" — we read recent terminal output
 * and extract what the agent is asking for.
 */
export function parseApproval(terminalOutput: string): ApprovalRequest | null {
  if (!terminalOutput) return null;

  // Take the last ~2000 chars (recent output)
  const recent = terminalOutput.slice(-2000);
  const lines = recent.split('\n');

  // Try each parser in order
  return (
    parseClaudeApproval(lines) ||
    parseGeminiApproval(lines) ||
    parseCodexApproval(lines) ||
    parseGenericApproval(lines)
  );
}

function parseClaudeApproval(lines: string[]): ApprovalRequest | null {
  // Claude Code patterns:
  // "Allow edit to <file>? [Y/n]"
  // "Allow command: <cmd>? [Y/n]"
  // "Do you want to apply these changes? (y/n)"
  // Permission dialog: "Yes, allow once" / "No, and tell Claude..."

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = stripAnsi(lines[i]);

    // File edit approval
    const editMatch = line.match(/Allow edit to (.+)\?\s*\[Y\/n\]/i);
    if (editMatch) {
      return {
        type: 'file_edit',
        summary: `Edit ${editMatch[1]}`,
        fullContent: extractContext(lines, i),
      };
    }

    // Command approval
    const cmdMatch = line.match(/Allow command:\s*(.+)\?\s*\[Y\/n\]/i);
    if (cmdMatch) {
      return {
        type: 'command',
        summary: `Run: ${cmdMatch[1]}`,
        command: cmdMatch[1],
        fullContent: extractContext(lines, i),
      };
    }

    // Alternative patterns
    if (line.includes('Do you want to apply these changes')) {
      return {
        type: 'file_edit',
        summary: 'Apply changes',
        fullContent: extractContext(lines, i),
      };
    }

    if (line.includes('Do you want to run this command')) {
      return {
        type: 'command',
        summary: 'Run command',
        fullContent: extractContext(lines, i),
      };
    }

    // Permission dialog (newer Claude Code)
    if (line.includes('Yes, allow once') || line.includes('No, and tell Claude')) {
      // Look backwards for the question
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        const prev = stripAnsi(lines[j]);
        if (prev.includes('wants to edit') || prev.includes('wants to write')) {
          return {
            type: 'file_edit',
            summary: prev.trim(),
            fullContent: extractContext(lines, j),
          };
        }
        if (prev.includes('wants to run') || prev.includes('wants to execute')) {
          return {
            type: 'command',
            summary: prev.trim(),
            fullContent: extractContext(lines, j),
          };
        }
      }
      return {
        type: 'question',
        summary: 'Permission requested',
        fullContent: extractContext(lines, i),
      };
    }
  }

  return null;
}

function parseGeminiApproval(lines: string[]): ApprovalRequest | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = stripAnsi(lines[i]);
    if (line.includes('Yes, allow once') && line.includes("No, don't allow")) {
      return {
        type: 'question',
        summary: 'Gemini permission requested',
        fullContent: extractContext(lines, i),
      };
    }
  }
  return null;
}

function parseCodexApproval(lines: string[]): ApprovalRequest | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = stripAnsi(lines[i]);
    if (line.match(/Continue\?\s*\(Y\/n\)/i)) {
      return {
        type: 'question',
        summary: 'Codex: Continue?',
        fullContent: extractContext(lines, i),
      };
    }
  }
  return null;
}

function parseGenericApproval(lines: string[]): ApprovalRequest | null {
  // Fallback: look for any y/n prompt
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = stripAnsi(lines[i]);
    if (line.match(/\[Y\/n\]|\(y\/n\)|\(yes\/no\)/i)) {
      return {
        type: 'question',
        summary: line.trim().slice(0, 80),
        fullContent: extractContext(lines, i),
      };
    }
  }
  return null;
}

/** Extract surrounding context lines around a match */
function extractContext(lines: string[], matchIndex: number): string {
  const start = Math.max(0, matchIndex - 20);
  const end = Math.min(lines.length, matchIndex + 5);
  return lines
    .slice(start, end)
    .map(l => stripAnsi(l))
    .join('\n');
}

/** Strip ANSI escape sequences from terminal output */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}
