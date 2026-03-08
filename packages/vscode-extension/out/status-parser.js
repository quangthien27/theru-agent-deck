"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripAnsi = stripAnsi;
exports.detectStatus = detectStatus;
exports.parseApproval = parseApproval;
// ── ANSI stripping (single-pass, no regex — avoids catastrophic backtracking) ──
// TUI-aware: inserts spaces/newlines at cursor position boundaries so words
// from cursor-positioned output don't merge together.
function stripAnsi(content) {
    if (!content.includes('\x1b') && !content.includes('\x9B'))
        return content;
    let result = '';
    let i = 0;
    let lastRow = -1;
    while (i < content.length) {
        if (content[i] === '\x1b') {
            // CSI sequence: ESC [ params letter
            if (i + 1 < content.length && content[i + 1] === '[') {
                let j = i + 2;
                let params = '';
                while (j < content.length) {
                    const c = content[j];
                    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
                        // c is the final byte of the CSI sequence
                        if (c === 'H' || c === 'f') {
                            // Cursor position (CUP): ESC[row;colH or ESC[H (home)
                            const parts = params.split(';');
                            const row = parseInt(parts[0]) || 1;
                            if (lastRow !== -1 && row !== lastRow) {
                                result += '\n'; // New row → newline
                            }
                            else if (result.length > 0 && result[result.length - 1] !== ' ' && result[result.length - 1] !== '\n') {
                                result += ' '; // Same row, different col → space
                            }
                            lastRow = row;
                        }
                        else if (c === 'J') {
                            // Erase display: ESC[2J = clear screen
                            if (params === '2' || params === '3') {
                                result += '\n';
                                lastRow = -1;
                            }
                        }
                        j++;
                        break;
                    }
                    params += c;
                    j++;
                }
                i = j;
                continue;
            }
            // OSC sequence: ESC ] ... BEL
            if (i + 1 < content.length && content[i + 1] === ']') {
                const bellPos = content.indexOf('\x07', i);
                if (bellPos !== -1) {
                    i = bellPos + 1;
                    continue;
                }
                const stPos = content.indexOf('\x1b\\', i);
                if (stPos !== -1) {
                    i = stPos + 2;
                    continue;
                }
            }
            // Other: ESC + single char
            if (i + 1 < content.length) {
                i += 2;
                continue;
            }
        }
        if (content.charCodeAt(i) === 0x9B) {
            let j = i + 1;
            while (j < content.length) {
                const c = content[j];
                if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
                    j++;
                    break;
                }
                j++;
            }
            i = j;
            continue;
        }
        result += content[i];
        i++;
    }
    return result;
}
// ── Shared prompt patterns ──
// Used across multiple agent detectors to avoid duplication.
/** Confirmation prompt patterns common to many CLI tools */
const COMMON_CONFIRM_PROMPTS = [
    '(Y/n)', '(y/N)', '[Y/n]', '[y/N]',
    '(y/n)', '(yes/no)', '[yes/no]',
    '(Y)es/(N)o', '[Yes]:', '[No]:',
    'Continue?', 'Proceed?',
    'Press Enter to continue',
];
/** Permission/approval prompts shared across agents */
const COMMON_PERMISSION_PROMPTS = [
    'Yes, allow once',
    'Yes, allow always',
    'Allow once',
    'Allow always',
    'Do you want to proceed',
    'Would you like to proceed',
];
/** Check if content matches any patterns in a list */
function matchesAny(content, patterns) {
    for (const p of patterns) {
        if (content.includes(p))
            return true;
    }
    return false;
}
// ── Spinner & busy detection constants ──
const SPINNER_CHARS = [
    '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏', // braille
    '✳', '✽', '✶', '✢', // Claude 2.1.25+ asterisk spinner
];
const SPINNER_SET = new Set(SPINNER_CHARS);
// Box-drawing chars to skip when checking for spinners
const BOX_CHARS = new Set(['│', '├', '└', '─', '┌', '┐', '┘', '┤', '┬', '┴', '┼', '╭', '╰', '╮', '╯']);
// ── Get last N non-empty lines ──
function getLastLines(content, count) {
    const lines = content.split('\n');
    const result = [];
    for (let i = lines.length - 1; i >= 0 && result.length < count; i--) {
        const line = lines[i].trim();
        if (line !== '')
            result.unshift(lines[i]);
    }
    return result;
}
// ── Claude-specific detection ──
function isClaudeBusy(lastLines, recentLower) {
    // Check explicit busy text
    if (recentLower.includes('ctrl+c to interrupt') || recentLower.includes('esc to interrupt')) {
        return true;
    }
    // Check spinner chars in last 10 lines (skip box-drawing lines)
    const checkLines = lastLines.slice(-10);
    for (const line of checkLines) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        const firstChar = trimmed[0];
        if (BOX_CHARS.has(firstChar))
            continue;
        for (const ch of trimmed) {
            if (SPINNER_SET.has(ch))
                return true;
        }
    }
    // Check whimsical words with timing info (ellipsis + tokens)
    if (recentLower.includes('…') && recentLower.includes('tokens')) {
        return true;
    }
    if (recentLower.includes('thinking') && recentLower.includes('tokens')) {
        return true;
    }
    return false;
}
function isClaudeWaiting(lastLines, recentContent) {
    // Shared patterns
    if (matchesAny(recentContent, COMMON_CONFIRM_PROMPTS))
        return true;
    if (matchesAny(recentContent, COMMON_PERMISSION_PROMPTS))
        return true;
    // Claude-specific permission dialog patterns
    const claudePrompts = [
        'No, and tell Claude what to do differently',
        '│ Do you want',
        '│ Would you like',
        '│ Allow',
        '❯ Yes', '❯ No', '❯ Allow',
        '❯ 1.', '❯ 2.', // Numbered option lists (e.g. "❯ 1. Yes")
        '1. Yes', '2. No', // Numbered Yes/No without cursor
        'Do you trust the files in this folder?',
        'Allow this MCP server',
        'Run this command?',
        'Execute this?',
        'Action Required',
        'Allow execution of',
        'Use arrow keys to navigate',
        'Press Enter to select',
        'Approve this plan?', 'Execute plan?',
    ];
    if (matchesAny(recentContent, claudePrompts))
        return true;
    // NOTE: standalone ">" / "❯" prompt = IDLE (ready for next message), NOT waiting
    // That's handled by isClaudeIdle() below
    return false;
}
function isClaudeIdle(lastLines) {
    // Standalone prompt character means Claude finished and is ready for input
    const checkLines = lastLines.slice(-5);
    for (const line of checkLines) {
        let clean = stripAnsi(line).trim();
        clean = clean.replace(/\u00A0/g, ' ');
        if (clean === '>' || clean === '❯' || clean === '> ' || clean === '❯ ')
            return true;
        if (clean.startsWith('❯ Try ') || clean.startsWith('> Try '))
            return true;
    }
    return false;
}
// ── Gemini-specific detection ──
function isGeminiBusy(recentLower) {
    // Only check the tail — Gemini's TUI redraws constantly, so stale
    // "esc to cancel" from earlier working state lingers in the buffer.
    // If idle signal is in the same tail region, agent is NOT busy.
    const tail = recentLower.slice(-500);
    if (!tail.includes('esc to cancel'))
        return false;
    // If idle indicators are also present in the tail, it's idle not busy
    if (tail.includes('ctrl+t to view') || tail.includes('type your message') || tail.includes('enter a prompt'))
        return false;
    return true;
}
function isGeminiWaiting(lastLines, recentContent) {
    if (matchesAny(recentContent, COMMON_CONFIRM_PROMPTS))
        return true;
    if (matchesAny(recentContent, COMMON_PERMISSION_PROMPTS))
        return true;
    return false;
}
function isGeminiIdle(lastLines, recentContent) {
    for (const line of lastLines.slice(-10)) {
        const trimmed = line.trim();
        if (trimmed === 'gemini>' || trimmed.includes('gemini>'))
            return true;
        if (trimmed.includes('Type your message'))
            return true;
    }
    // Gemini shows a box-drawing input area when idle
    const lower = recentContent.toLowerCase();
    if (lower.includes('type your message') || lower.includes('enter a prompt'))
        return true;
    // Gemini shows "ctrl+t to view" in the idle header — use last 500 chars
    // to avoid matching old content, and check "esc to cancel" only in the same region
    const tail = lower.slice(-500);
    if (tail.includes('ctrl+t to view') && !tail.includes('esc to cancel'))
        return true;
    // Gemini may show "gemini" prompt in TUI mode
    if (tail.includes('gemini >') || tail.includes('gemini>'))
        return true;
    return false;
}
// ── OpenCode-specific detection ──
function isOpenCodeBusy(recentContent) {
    // Use tail to avoid stale TUI content
    const tail = recentContent.slice(-500);
    if (tail.includes('press enter to send') || tail.includes('Ask anything'))
        return false;
    if (tail.includes('esc interrupt') || tail.includes('esc to exit'))
        return true;
    const pulseChars = ['█', '▓', '▒', '░'];
    for (const ch of pulseChars) {
        if (tail.includes(ch))
            return true;
    }
    const busyStrings = ['Thinking...', 'Generating...', 'Building tool call...', 'Waiting for tool response...'];
    for (const s of busyStrings) {
        if (tail.includes(s))
            return true;
    }
    return false;
}
function isOpenCodeWaiting(_recentContent) {
    // OpenCode doesn't have traditional approval prompts
    return false;
}
function isOpenCodeIdle(recentContent) {
    return recentContent.includes('press enter to send') ||
        recentContent.includes('Ask anything');
}
// ── Codex-specific detection ──
function isCodexBusy(recentLower) {
    return recentLower.includes('esc to interrupt') || recentLower.includes('ctrl+c to interrupt');
}
function isCodexWaiting(recentContent) {
    if (matchesAny(recentContent, COMMON_CONFIRM_PROMPTS))
        return true;
    // Codex-specific setup prompts
    const lower = recentContent.toLowerCase();
    if (lower.includes('recommend') && lower.includes('requiring'))
        return true;
    if (lower.includes('approve') && lower.includes('suggest'))
        return true;
    if (lower.includes('full-auto') && lower.includes('apply changes'))
        return true;
    // Codex numbered selection: "> 1. Yes, allow..." / "> 2. No, ask me..."
    if (recentContent.includes('> 1.') && recentContent.includes('> 2.'))
        return true;
    return false;
}
function isCodexIdle(recentContent, lastLines) {
    if (recentContent.includes('codex>') || recentContent.includes('How can I help'))
        return true;
    // Codex uses ">" as its TUI prompt at row 1, col 1
    // Check last lines for standalone ">"
    for (const line of lastLines.slice(-5)) {
        const clean = stripAnsi(line).trim();
        if (clean === '>' || clean === '> ')
            return true;
    }
    // Also check the tail of stripped content for the prompt
    const tail = recentContent.slice(-300).trim();
    if (tail.endsWith('>') || tail.endsWith('> '))
        return true;
    return false;
}
// ── Aider-specific detection ──
function isAiderWaiting(lastLines, recentContent) {
    if (matchesAny(recentContent, COMMON_CONFIRM_PROMPTS))
        return true;
    return false;
}
function isAiderIdle(lastLines) {
    for (const line of lastLines.slice(-5)) {
        const trimmed = stripAnsi(line).trim();
        if (trimmed === 'aider>' || trimmed.startsWith('aider>'))
            return true;
        // Aider also uses bare ">" after setup completes
        if (trimmed === '>' || trimmed === '> ')
            return true;
    }
    return false;
}
// ── Generic detection ──
function isGenericWaiting(lastLines, recentContent) {
    if (matchesAny(recentContent, COMMON_CONFIRM_PROMPTS))
        return true;
    if (matchesAny(recentContent, COMMON_PERMISSION_PROMPTS))
        return true;
    return false;
}
function isGenericIdle(lastLines) {
    if (lastLines.length === 0)
        return false;
    const last = stripAnsi(lastLines[lastLines.length - 1]).trim();
    // Shell prompts
    if (last.endsWith('$') || last.endsWith('#') || last.endsWith('%'))
        return true;
    if (last.endsWith('$ ') || last.endsWith('# ') || last.endsWith('% '))
        return true;
    // Generic interactive prompt
    if (last === '>' || last === '> ')
        return true;
    return false;
}
// ── Main status detection ──
function detectStatus(output, currentStatus, agentType) {
    if (!output || output.length < 10)
        return currentStatus;
    const stripped = stripAnsi(output.slice(-4000));
    const lastLines = getLastLines(stripped, 15);
    if (lastLines.length === 0 && stripped.trim().length === 0)
        return currentStatus;
    // Use the full stripped tail for pattern matching (not just joined lines).
    // TUI apps use cursor positioning instead of newlines, so getLastLines
    // may return very few entries. The flat stripped text preserves all content.
    const recentContent = stripped.slice(-2000);
    const recentLower = recentContent.toLowerCase();
    const tool = (agentType || '').toLowerCase();
    // ── Step 1: Check IDLE first ──
    // If the tail of the buffer shows an idle prompt, earlier waiting/busy
    // signals are stale (agent moved past them). This prevents old prompts
    // lingering in the buffer from keeping status stuck on "waiting".
    let idle = false;
    switch (tool) {
        case 'claude':
            idle = isClaudeIdle(lastLines);
            break;
        case 'gemini':
            idle = isGeminiIdle(lastLines, recentContent);
            break;
        case 'opencode':
            idle = isOpenCodeIdle(recentContent);
            break;
        case 'codex':
            idle = isCodexIdle(recentContent, lastLines);
            break;
        case 'aider':
            idle = isAiderIdle(lastLines);
            break;
        default:
            idle = isGenericIdle(lastLines);
    }
    if (idle)
        return 'idle';
    // ── Step 2: Check WAITING ──
    // Only reached if idle prompt is NOT at the tail. This means any
    // confirmation prompt found is still the active, unanswered one.
    let waiting = false;
    switch (tool) {
        case 'claude':
            waiting = isClaudeWaiting(lastLines, recentContent);
            break;
        case 'gemini':
            waiting = isGeminiWaiting(lastLines, recentContent);
            break;
        case 'opencode':
            waiting = isOpenCodeWaiting(recentContent);
            break;
        case 'codex':
            waiting = isCodexWaiting(recentContent);
            break;
        case 'aider':
            waiting = isAiderWaiting(lastLines, recentContent);
            break;
        default:
            waiting = isGenericWaiting(lastLines, recentContent);
    }
    if (waiting)
        return 'waiting';
    // ── Step 3: Check BUSY ──
    let busy = false;
    switch (tool) {
        case 'claude':
            busy = isClaudeBusy(lastLines, recentLower);
            break;
        case 'gemini':
            busy = isGeminiBusy(recentLower);
            break;
        case 'opencode':
            busy = isOpenCodeBusy(recentContent);
            break;
        case 'codex':
            busy = isCodexBusy(recentLower);
            break;
        default:
            // Generic busy: look for braille spinners
            for (const line of lastLines.slice(-5)) {
                for (const ch of line) {
                    if (SPINNER_SET.has(ch)) {
                        busy = true;
                        break;
                    }
                }
                if (busy)
                    break;
            }
    }
    if (busy)
        return 'working';
    // ── Step 4: Default ──
    // If we were working and no idle/waiting/busy detected, stay working
    // (output may have just paused briefly between tool calls)
    return currentStatus;
}
// ── Approval parsing (for Logi Plugin display) ──
function parseApproval(terminalOutput) {
    if (!terminalOutput)
        return null;
    const stripped = stripAnsi(terminalOutput.slice(-3000));
    const lines = stripped.split('\n');
    return (parseClaudeApproval(lines) ||
        parseGenericApproval(lines));
}
function parseClaudeApproval(lines) {
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
        const line = lines[i].trim();
        const editMatch = line.match(/Allow edit to (.+)\?\s*\[Y\/n\]/i);
        if (editMatch) {
            return { type: 'file_edit', summary: `Edit ${editMatch[1]}`, fullContent: extractContext(lines, i) };
        }
        const cmdMatch = line.match(/Allow command:\s*(.+)\?\s*\[Y\/n\]/i);
        if (cmdMatch) {
            return { type: 'command', summary: `Run: ${cmdMatch[1]}`, command: cmdMatch[1], fullContent: extractContext(lines, i) };
        }
        if (line.includes('No, and tell Claude what to do differently')) {
            // Look backwards for the question
            for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
                const prev = lines[j].trim();
                if (prev.includes('wants to edit') || prev.includes('wants to write')) {
                    return { type: 'file_edit', summary: prev, fullContent: extractContext(lines, j) };
                }
                if (prev.includes('wants to run') || prev.includes('wants to execute')) {
                    return { type: 'command', summary: prev, fullContent: extractContext(lines, j) };
                }
            }
            return { type: 'question', summary: 'Permission requested', fullContent: extractContext(lines, i) };
        }
        if (line.includes('Do you want to apply these changes')) {
            return { type: 'file_edit', summary: 'Apply changes', fullContent: extractContext(lines, i) };
        }
    }
    return null;
}
function parseGenericApproval(lines) {
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
        const line = lines[i];
        if (matchesAny(line, COMMON_CONFIRM_PROMPTS)) {
            return { type: 'question', summary: line.trim().slice(0, 80), fullContent: extractContext(lines, i) };
        }
    }
    return null;
}
function extractContext(lines, matchIndex) {
    const start = Math.max(0, matchIndex - 20);
    const end = Math.min(lines.length, matchIndex + 5);
    return lines.slice(start, end).join('\n');
}
//# sourceMappingURL=status-parser.js.map