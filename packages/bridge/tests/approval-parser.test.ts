import { describe, expect, test } from 'bun:test';
import { parseApproval } from '../src/approval-parser.js';

describe('parseApproval', () => {
  test('returns null for empty input', () => {
    expect(parseApproval('')).toBeNull();
    expect(parseApproval('   ')).toBeNull();
  });

  test('parses Claude file edit approval', () => {
    const output = `
Some previous output here
Editing file...

Allow edit to src/auth.ts? [Y/n]
`;
    const result = parseApproval(output);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('file_edit');
    expect(result!.summary).toBe('Edit src/auth.ts');
  });

  test('parses Claude command approval', () => {
    const output = `
Running tests...

Allow command: npm test? [Y/n]
`;
    const result = parseApproval(output);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('command');
    expect(result!.summary).toBe('Run: npm test');
    expect(result!.command).toBe('npm test');
  });

  test('parses Claude alternative apply changes prompt', () => {
    const output = `
- function old() {}
+ function new() {}

Do you want to apply these changes? (y/n)
`;
    const result = parseApproval(output);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('file_edit');
  });

  test('parses Claude permission dialog', () => {
    const output = `
Claude wants to edit src/index.ts

  Yes, allow once
  Yes, allow always
  No, and tell Claude why
`;
    const result = parseApproval(output);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('file_edit');
    expect(result!.summary).toContain('wants to edit');
  });

  test('parses Codex continue prompt', () => {
    const output = `
Applied changes to 3 files.

Continue? (Y/n)
`;
    const result = parseApproval(output);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('question');
    expect(result!.summary).toContain('Continue');
  });

  test('parses generic y/n prompt', () => {
    const output = `
Some agent asking something [Y/n]
`;
    const result = parseApproval(output);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('question');
  });

  test('strips ANSI codes before parsing', () => {
    const output = `\x1b[33mAllow edit to src/auth.ts? [Y/n]\x1b[0m`;
    const result = parseApproval(output);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('file_edit');
  });

  test('returns null for normal terminal output', () => {
    const output = `
$ git status
On branch main
nothing to commit, working tree clean

claude> Working on your request...
`;
    expect(parseApproval(output)).toBeNull();
  });

  test('extracts context around approval', () => {
    const output = `
Thinking...
Editing src/auth.ts
- const token = getToken();
+ const token = await getToken();
+ if (!token) throw new Error('No token');

Allow edit to src/auth.ts? [Y/n]
`;
    const result = parseApproval(output);
    expect(result).not.toBeNull();
    expect(result!.fullContent).toContain('getToken');
    expect(result!.fullContent).toContain('Allow edit');
  });
});
