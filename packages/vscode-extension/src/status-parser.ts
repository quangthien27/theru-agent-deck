import type { AgentStatus, ApprovalRequest } from './protocol';

// ── ANSI stripping (single-pass, no regex — avoids catastrophic backtracking) ──
// TUI-aware: inserts spaces/newlines at cursor position boundaries so words
// from cursor-positioned output don't merge together.

export function stripAnsi(content: string): string {
  if (!content.includes('\x1b') && !content.includes('\x9B')) return content;

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
              } else if (result.length > 0 && result[result.length - 1] !== ' ' && result[result.length - 1] !== '\n') {
                result += ' '; // Same row, different col → space
              }
              lastRow = row;
            } else if (c === 'J') {
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
        if (bellPos !== -1) { i = bellPos + 1; continue; }
        const stPos = content.indexOf('\x1b\\', i);
        if (stPos !== -1) { i = stPos + 2; continue; }
      }
      // Other: ESC + single char
      if (i + 1 < content.length) { i += 2; continue; }
    }
    if (content.charCodeAt(i) === 0x9B) {
      let j = i + 1;
      while (j < content.length) {
        const c = content[j];
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) { j++; break; }
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
function matchesAny(content: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (content.includes(p)) return true;
  }
  return false;
}

/** Check if content matches common confirmation or permission prompts */
function matchesCommonPrompts(content: string): boolean {
  return matchesAny(content, COMMON_CONFIRM_PROMPTS) || matchesAny(content, COMMON_PERMISSION_PROMPTS);
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

function getLastLines(content: string, count: number): string[] {
  const lines = content.split('\n');
  const result: string[] = [];
  for (let i = lines.length - 1; i >= 0 && result.length < count; i--) {
    const line = lines[i].trim();
    if (line !== '') result.unshift(lines[i]);
  }
  return result;
}

// ── Claude interactive UI patterns ──
// AskUserQuestion UI uses ❯ as cursor, checkboxes, and navigation hints.
// These indicate an active interactive prompt, not idle state.
const CLAUDE_INTERACTIVE_UI_PATTERNS = [
  'Esc to cancel', 'Esctocancel',
  'Enter to select', 'Entertoselect',
  'Tab/Arrow',
];

function hasClaudeInteractiveUI(content: string): boolean {
  if (matchesAny(content, CLAUDE_INTERACTIVE_UI_PATTERNS)) return true;
  if (content.includes('☐') && content.includes('Submit')) return true;
  return false;
}

// ── Claude-specific detection ──

function isClaudeBusy(lastLines: string[], recentLower: string): boolean {
  // Check explicit busy text
  if (recentLower.includes('ctrl+c to interrterrupt') || recentLower.includes('esc to interrterrupt')) {
    return true;
  }

  // Check spinner chars in last 10 lines (skip box-drawing lines)
  const checkLines = lastLines.slice(-10);
  for (const line of checkLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const firstChar = trimmed[0];
    if (BOX_CHARS.has(firstChar)) continue;
    for (const ch of trimmed) {
      if (SPINNER_SET.has(ch)) return true;
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

function isClaudeWaiting(_lastLines: string[], recentContent: string): boolean {
  // Only check the tail — stale prompts from answered questions linger in the
  // full buffer. Using the tail ensures we only match the currently active prompt.
  const tail = recentContent.slice(-800);

  if (matchesCommonPrompts(tail)) return true;

  // Claude-specific permission dialog patterns
  const claudePrompts = [
    'No, and tell Claude what to do differently',
    '│ Do you want',
    '│ Would you like',
    '│ Allow',
    '❯ Yes', '❯ No', '❯ Allow',
    '❯ 1.', '❯ 2.',     // Numbered option lists (e.g. "❯ 1. Yes")
    '1. Yes', '2. No',   // Numbered Yes/No without cursor
    'Do you trust the files in this folder?',
    'Allow this MCP server',
    'Run this command?',
    'Execute this?',
    'Action Required',
    'Allow execution of',
    'Use arrow keys to navigate',
    'Press Enter to select',
    'Approve this plan?', 'Execute plan?',
    'Tab/Arrow keys',
    'Tab/Arrowkeys',
  ];
  if (matchesAny(tail, claudePrompts)) return true;

  // AskUserQuestion interactive UI (checkboxes, selection, etc.)
  if (hasClaudeInteractiveUI(tail)) return true;

  // AskUserQuestion checkbox UI: ☐ or ✔ with section labels
  if (tail.includes('☐') || tail.includes('✔')) {
    if (tail.includes('select')) return true;
  }

  // NOTE: standalone ">" / "❯" prompt = IDLE (ready for next message), NOT waiting
  // That's handled by isClaudeIdle() below
  return false;
}

function isClaudeIdle(lastLines: string[], recentContent: string): boolean {
  // Standalone prompt character means Claude finished and is ready for input.
  // lastLines are already stripped (from stripAnsi in detectStatus).
  // Check this FIRST: if ❯ is at the tail, any interactive UI patterns
  // earlier in the buffer are stale (user already dismissed them).
  const checkLines = lastLines.slice(-5);
  let hasPrompt = false;
  for (const line of checkLines) {
    const clean = line.trim().replace(/\u00A0/g, ' ');
    if (clean === '>' || clean === '❯' || clean === '> ' || clean === '❯ ') { hasPrompt = true; break; }
    if (clean.startsWith('❯ Try ') || clean.startsWith('> Try ')) { hasPrompt = true; break; }
  }

  if (!hasPrompt) return false;

  // If interactive selection UI is active in the TAIL, ❯ is a cursor not idle.
  // Only check the tail (~500 chars) — stale patterns further back are irrelevant.
  const tail = recentContent.slice(-500);
  if (hasClaudeInteractiveUI(tail)) return false;

  return true;
}

// ── Gemini-specific detection ──

function isGeminiBusy(recentLower: string): boolean {
  // Only check the tail — Gemini's TUI redraws constantly, so stale
  // "esc to cancel" from earlier working state lingers in the buffer.
  // If idle signal is in the same tail region, agent is NOT busy.
  const tail = recentLower.slice(-500);
  if (!tail.includes('esc to cancel')) return false;
  // If idle indicators are also present in the tail, it's idle not busy
  if (tail.includes('ctrl+t to view') || tail.includes('type your message') || tail.includes('enter a prompt')) return false;
  return true;
}

function isGeminiWaiting(_lastLines: string[], recentContent: string): boolean {
  return matchesCommonPrompts(recentContent);
}

function isGeminiIdle(lastLines: string[], recentContent: string): boolean {
  for (const line of lastLines.slice(-10)) {
    const trimmed = line.trim();
    if (trimmed === 'gemini>' || trimmed.includes('gemini>')) return true;
    if (trimmed.includes('Type your message')) return true;
  }
  // Gemini shows a box-drawing input area when idle
  const lower = recentContent.toLowerCase();
  if (lower.includes('type your message') || lower.includes('enter a prompt')) return true;
  // Gemini shows "ctrl+t to view" in the idle header — use last 500 chars
  // to avoid matching old content, and check "esc to cancel" only in the same region
  const tail = lower.slice(-500);
  if (tail.includes('ctrl+t to view') && !tail.includes('esc to cancel')) return true;
  // Gemini may show "gemini" prompt in TUI mode
  if (tail.includes('gemini >') || tail.includes('gemini>')) return true;
  return false;
}

// ── OpenCode-specific detection ──

/** Check if OpenCode's interactive selection UI is active in the tail */
function isOpenCodeInteractiveUI(tail: string): boolean {
  if (tail.includes('enter confirm') && tail.includes('esc dismiss')) return true;
  if (tail.includes('select') && tail.includes('confirm') && tail.includes('dismiss')) return true;
  return false;
}

/** Check if OpenCode's tabbed multi-question form (AskUserQuestion) is active.
 *  Shows tab labels like "Favorite Language  Productive Hours  Confirm"
 *  with numbered options "1. TypeScript  2. Python" */
function isOpenCodeTabbedForm(tail: string): boolean {
  // "Confirm" tab label + numbered options = tabbed question form
  // The "Confirm" tab is always the last tab (submit button equivalent)
  if (!tail.includes('Confirm')) return false;
  // Must also have numbered options nearby (at least "1." and "2.")
  if (/\b1\.\s+\S/.test(tail) && /\b2\.\s+\S/.test(tail)) return true;
  return false;
}

function isOpenCodeBusy(recentContent: string): boolean {
  // Use tail to avoid stale TUI content
  const tail = recentContent.slice(-500);
  // Idle indicators override busy — if these are in the tail, not busy
  if (tail.includes('press enter to send') || tail.includes('Ask anything')) return false;
  if (isOpenCodeInteractiveUI(tail)) return false;
  if (isOpenCodeTabbedForm(tail)) return false;
  // Explicit busy text
  if (tail.includes('esc interrupt') || tail.includes('esc to exit')) return true;
  const busyStrings = ['Thinking...', 'Generating...', 'Building tool call...', 'Waiting for tool response...'];
  for (const s of busyStrings) {
    if (tail.includes(s)) return true;
  }
  // NOTE: Do NOT check for block chars (█, ▓, ▒, ░) — OpenCode's TUI uses
  // these for headers, borders, and UI decorations, causing false positives.
  return false;
}

function isOpenCodeWaiting(recentContent: string): boolean {
  // Only check the tail — stale prompts from dismissed questions linger in the buffer
  const tail = recentContent.slice(-800);
  if (matchesCommonPrompts(tail)) return true;

  // OpenCode interactive selection UI (AskUserQuestion equivalent)
  // Shows: "⇆ tab  ↑↓ select  enter confirm  esc dismiss"
  if (isOpenCodeInteractiveUI(tail)) return true;
  // Tab navigation with selection options
  if (tail.includes('tab') && tail.includes('select') && tail.includes('esc dismiss')) return true;

  // OpenCode tabbed multi-question form — shows tab labels ending with "Confirm"
  // and numbered options (1. TypeScript, 2. Python, etc.)
  if (isOpenCodeTabbedForm(tail)) return true;
  return false;
}

function isOpenCodeIdle(recentContent: string): boolean {
  const tail = recentContent.slice(-800);

  // If any interactive UI is active, not idle — check this first
  if (isOpenCodeInteractiveUI(tail)) return false;
  if (isOpenCodeTabbedForm(tail)) return false;

  // Initial empty prompt — always idle regardless of other content
  if (tail.includes('press enter to send') || tail.includes('Ask anything')) return true;

  // Post-conversation idle: OpenCode shows the conversation with an input area.
  // The status bar shows "ctrl+p commands" and "tab agents" when ready.
  // Check tail for status bar presence AND absence of busy indicators.
  const tailLower = tail.toLowerCase();
  const hasBusy = tailLower.includes('thinking...') || tailLower.includes('generating...')
    || tailLower.includes('esc interrupt') || tailLower.includes('esc to exit')
    || tailLower.includes('building tool call') || tailLower.includes('waiting for tool response');
  if (!hasBusy && tail.includes('ctrl+p commands')) return true;
  // OpenCode shows "Build" + model name at bottom when idle in conversation
  if (!hasBusy && tail.includes('Build') && tail.includes('Anthropic')) return true;

  return false;
}

// ── Codex-specific detection ──

function isCodexBusy(recentLower: string): boolean {
  // Terminal may truncate "Esc to interrupt" → "Esc to in", so match prefix
  if (recentLower.includes('esc to interr') || recentLower.includes('ctrl+c to interr')) return true;
  // "Working (30s •" timing indicator
  if (/working\s*\(\d+s/.test(recentLower)) return true;
  // Tool usage lines: "• Ran", "• Explored", "• Read" (Codex shows these while active)
  if (recentLower.includes('• ran ') || recentLower.includes('• explored') || recentLower.includes('• read ')) return true;
  return false;
}

function isCodexWaiting(recentContent: string): boolean {
  if (matchesAny(recentContent, COMMON_CONFIRM_PROMPTS)) return true;

  // Codex-specific setup prompts
  const lower = recentContent.toLowerCase();
  if (lower.includes('recommend') && lower.includes('requiring')) return true;
  if (lower.includes('approve') && lower.includes('suggest')) return true;
  if (lower.includes('full-auto') && lower.includes('apply changes')) return true;
  // Codex numbered selection: "> 1. Yes, allow..." / "> 2. No, ask me..."
  if (recentContent.includes('> 1.') && recentContent.includes('> 2.')) return true;
  return false;
}

function isCodexIdle(recentContent: string, lastLines: string[]): boolean {
  if (recentContent.includes('codex>') || recentContent.includes('How can I help')) return true;
  // Codex ready state: shows task suggestions and command hints
  if (recentContent.includes('describe a task') || recentContent.includes('To get started')) return true;
  if (recentContent.includes('/init') && recentContent.includes('/status') && recentContent.includes('/approvals')) return true;
  // Post-completion idle: Codex footer (⏎ send ⇧⏎ newline) is ALWAYS visible,
  // so we can't use it as an idle signal. Instead, idle = footer present WITHOUT
  // any busy indicators (Esc to in*, Working (Xs, tool usage lines).
  // IMPORTANT: Only check the tail (~500 chars) for busy signals — stale
  // "Esc to interrupt" from a previous working state lingers in the full buffer.
  const tail500 = recentContent.slice(-500).toLowerCase();
  const hasBusySignal = tail500.includes('esc to interr') || /working\s*\(\d+s/.test(tail500)
    || tail500.includes('• ran ') || tail500.includes('• explored') || tail500.includes('• read ');
  if (!hasBusySignal && tail500.includes('send') && tail500.includes('newline') && tail500.includes('transcript')) return true;
  // Codex uses ">" as its TUI prompt at row 1, col 1
  // Check last lines for standalone ">" (lastLines already stripped)
  for (const line of lastLines.slice(-5)) {
    const clean = line.trim();
    if (clean === '>' || clean === '> ') return true;
  }
  // Also check the tail of stripped content for the prompt
  const tail = recentContent.slice(-300).trim();
  if (tail.endsWith('>') || tail.endsWith('> ')) return true;
  return false;
}

// ── Aider-specific detection ──

function isAiderWaiting(_lastLines: string[], recentContent: string): boolean {
  if (matchesAny(recentContent, COMMON_CONFIRM_PROMPTS)) return true;
  return false;
}

function isAiderIdle(lastLines: string[]): boolean {
  // lastLines are already stripped (from stripAnsi in detectStatus)
  for (const line of lastLines.slice(-3)) {
    const trimmed = line.trim();
    if (trimmed === 'aider>' || trimmed === 'aider> ') return true;
    // Bare ">" only counts as idle if it's the very last line (not followed by output)
    if (trimmed === '>' || trimmed === '> ') {
      // Make sure it's actually the last meaningful line
      if (line === lastLines[lastLines.length - 1] || line === lastLines[lastLines.length - 2]) return true;
    }
  }
  return false;
}

function isAiderBusy(lastLines: string[], recentLower: string): boolean {
  // Progress bars: "Scanning repo: 100%|██|"
  if (recentLower.includes('scanning repo') || recentLower.includes('repo-map')) return true;
  // "Updating repo map"
  if (recentLower.includes('updating repo map')) return true;
  // Aider shows "Thinking..." or model responses
  if (recentLower.includes('thinking...')) return true;
  // Progress bar characters
  if (recentLower.includes('█') || recentLower.includes('░')) return true;
  // "Applying edit" or "Committing"
  if (recentLower.includes('applying edit') || recentLower.includes('committing')) return true;
  // Braille spinners (fallback)
  for (const line of lastLines.slice(-5)) {
    for (const ch of line) {
      if (SPINNER_SET.has(ch)) return true;
    }
  }
  return false;
}

// ── Generic detection ──

function isGenericWaiting(_lastLines: string[], recentContent: string): boolean {
  return matchesCommonPrompts(recentContent);
}

function isGenericIdle(lastLines: string[]): boolean {
  if (lastLines.length === 0) return false;
  const last = stripAnsi(lastLines[lastLines.length - 1]).trim();
  // Shell prompts
  if (last.endsWith('$') || last.endsWith('#') || last.endsWith('%')) return true;
  if (last.endsWith('$ ') || last.endsWith('# ') || last.endsWith('% ')) return true;
  // Generic interactive prompt
  if (last === '>' || last === '> ') return true;
  return false;
}

// ── Error detection ──
// Check if recent output (near the tail) contains error messages.
// Used when agent appears idle — if errors are nearby, status = error.

/** Common error patterns across all agents */
const COMMON_ERROR_PATTERNS = [
  'error:', 'Error:', 'ERROR:',
  'Traceback (most recent call last)',
  'traceback (most recent call last)',
  'Exception:', 'exception:',
  'FATAL', 'fatal:',
  'panic:', 'PANIC:',
];

function hasRecentErrors(recentContent: string, agentType: string): boolean {
  // Only check the last ~800 chars — errors further back are stale
  const tail = recentContent.slice(-800);
  const tailLower = tail.toLowerCase();

  // Common API/runtime errors across all agents
  if (tailLower.includes('error:') || tailLower.includes('apierror')) return true;
  if (tailLower.includes('rate limit') || tailLower.includes('ratelimit')) return true;

  // Agent-specific errors
  switch (agentType) {
    case 'aider':
      if (tailLower.includes('litellm.') && tailLower.includes('error')) return true;
      if (tailLower.includes('api error')) return true;
      if (tailLower.includes('notfounderror') || tailLower.includes('not found')) return true;
      if (tailLower.includes('connection error') || tailLower.includes('timeout error')) return true;
      break;

    case 'claude':
      if (tailLower.includes('overloaded')) return true;
      if (tailLower.includes('crashed') || tailLower.includes('panic')) return true;
      break;

    case 'gemini':
      if (tailLower.includes('quota exceeded')) return true;
      break;
  }

  // Generic: check common patterns
  for (const p of COMMON_ERROR_PATTERNS) {
    if (tail.includes(p)) return true;
  }
  return false;
}

// ── Main status detection ──

export interface DetectionResult {
  status: AgentStatus;
  confidence: number;  // 0.0 = no idea, 1.0 = certain. AI fires below threshold (e.g. 0.6)
}

export function detectStatus(output: string, currentStatus: AgentStatus, agentType?: string): DetectionResult {
  if (!output || output.length < 10) return { status: currentStatus, confidence: 0.0 };

  const stripped = stripAnsi(output.slice(-4000));
  const lastLines = getLastLines(stripped, 15);
  if (lastLines.length === 0 && stripped.trim().length === 0) return { status: currentStatus, confidence: 0.0 };

  // Use the full stripped tail for pattern matching (not just joined lines).
  // TUI apps use cursor positioning instead of newlines, so getLastLines
  // may return very few entries. The flat stripped text preserves all content.
  const recentContent = stripped.slice(-2000);
  const recentLower = recentContent.toLowerCase();

  const tool = (agentType || '').toLowerCase();
  // Known agent type = higher base confidence. Generic/unknown = lower.
  const isKnownAgent = ['claude', 'gemini', 'opencode', 'codex', 'aider'].includes(tool);

  // ── Run all detectors independently ──
  // Collect which states match, then resolve conflicts.
  // If multiple match → confidence drops (ambiguous → AI should decide).

  // Check IDLE
  let idle = false;
  let idleConfidence = isKnownAgent ? 0.9 : 0.5;
  switch (tool) {
    case 'claude':
      idle = isClaudeIdle(lastLines, recentContent);
      idleConfidence = 0.95;
      break;
    case 'gemini':
      idle = isGeminiIdle(lastLines, recentContent);
      idleConfidence = 0.9;
      break;
    case 'opencode':
      idle = isOpenCodeIdle(recentContent);
      idleConfidence = 0.9;
      break;
    case 'codex':
      idle = isCodexIdle(recentContent, lastLines);
      if (idle && !recentContent.includes('codex>') && !recentContent.includes('How can I help')
          && !recentContent.includes('describe a task')) {
        idleConfidence = 0.6;
      } else {
        idleConfidence = 0.9;
      }
      break;
    case 'aider':
      idle = isAiderIdle(lastLines);
      idleConfidence = lastLines.slice(-3).some(l => l.trim().startsWith('aider>')) ? 0.95 : 0.5;
      break;
    default:
      idle = isGenericIdle(lastLines);
      idleConfidence = 0.4;
  }

  // Check WAITING
  let waiting = false;
  let waitingConfidence = isKnownAgent ? 0.9 : 0.5;
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

  // Check BUSY
  let busy = false;
  let busyConfidence = isKnownAgent ? 0.9 : 0.5;
  switch (tool) {
    case 'claude':
      busy = isClaudeBusy(lastLines, recentLower);
      busyConfidence = 0.95;
      break;
    case 'gemini':
      busy = isGeminiBusy(recentLower);
      busyConfidence = 0.85;
      break;
    case 'opencode':
      busy = isOpenCodeBusy(recentContent);
      busyConfidence = 0.85;
      break;
    case 'codex':
      busy = isCodexBusy(recentLower);
      busyConfidence = 0.9;
      break;
    case 'aider':
      busy = isAiderBusy(lastLines, recentLower);
      busyConfidence = 0.8;
      break;
    default:
      for (const line of lastLines.slice(-5)) {
        for (const ch of line) {
          if (SPINNER_SET.has(ch)) { busy = true; break; }
        }
        if (busy) break;
      }
      busyConfidence = 0.4;
  }

  // ── Resolve: count how many states matched ──
  const matches = [
    idle && { status: 'idle' as AgentStatus, confidence: idleConfidence },
    waiting && { status: 'waiting' as AgentStatus, confidence: waitingConfidence },
    busy && { status: 'working' as AgentStatus, confidence: busyConfidence },
  ].filter(Boolean) as { status: AgentStatus; confidence: number }[];

  if (matches.length === 1) {
    // Exactly one match — high confidence, use it directly
    const match = matches[0];
    // If idle, check for recent errors before returning
    if (match.status === 'idle' && hasRecentErrors(recentContent, tool)) {
      return { status: 'error', confidence: 0.85 };
    }
    return match;
  }

  if (matches.length > 1) {
    // Multiple states matched — ambiguous. Use priority order (idle > waiting > busy)
    // but drop confidence so AI classifier gets a chance to weigh in.
    const priority: AgentStatus[] = ['idle', 'waiting', 'working'];
    const winner = priority.find(s => matches.some(m => m.status === s))!;
    const winnerConf = matches.find(m => m.status === winner)!.confidence;
    // Halve confidence to signal ambiguity — this pushes below the AI threshold
    const ambiguousConfidence = Math.min(winnerConf * 0.5, 0.4);

    if (winner === 'idle' && hasRecentErrors(recentContent, tool)) {
      return { status: 'error', confidence: ambiguousConfidence };
    }
    return { status: winner, confidence: ambiguousConfidence };
  }

  // ── No match — check ERROR, then default ──
  if (hasRecentErrors(recentContent, tool)) {
    return { status: 'error', confidence: 0.7 };
  }
  return { status: currentStatus, confidence: 0.0 };
}

// ── Approval parsing (for Logi Plugin display) ──

export function parseApproval(terminalOutput: string): ApprovalRequest | null {
  if (!terminalOutput) return null;

  const stripped = stripAnsi(terminalOutput.slice(-3000));
  const lines = stripped.split('\n');

  return (
    parseClaudeApproval(lines) ||
    parseGenericApproval(lines)
  );
}

function parseClaudeApproval(lines: string[]): ApprovalRequest | null {
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

function parseGenericApproval(lines: string[]): ApprovalRequest | null {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
    const line = lines[i];
    if (matchesAny(line, COMMON_CONFIRM_PROMPTS)) {
      return { type: 'question', summary: line.trim().slice(0, 80), fullContent: extractContext(lines, i) };
    }
  }
  return null;
}

function extractContext(lines: string[], matchIndex: number): string {
  const start = Math.max(0, matchIndex - 20);
  const end = Math.min(lines.length, matchIndex + 5);
  return lines.slice(start, end).join('\n');
}
