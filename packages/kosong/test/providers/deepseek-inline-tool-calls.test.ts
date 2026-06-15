import type { StreamedMessagePart } from '#/message';
import {
  DEEPSEEK_TOOL_CALLS_BEGIN,
  DeepSeekInlineToolCallFilter,
  parseDeepSeekInlineToolCalls,
} from '#/providers/deepseek-inline-tool-calls';
import { OpenAILegacyStreamedMessage } from '#/providers/openai-legacy';
import { describe, expect, it } from 'vitest';

const SEP = '▁';
const callBlock = (name: string, args: string) =>
  `<|tool${SEP}call${SEP}begin|>function<|tool${SEP}sep|>${name}\n\`\`\`json\n${args}\n\`\`\`<|tool${SEP}call${SEP}end|>`;
const wrap = (...blocks: string[]) =>
  `${DEEPSEEK_TOOL_CALLS_BEGIN}${blocks.join('')}<|tool${SEP}calls${SEP}end|>`;

describe('parseDeepSeekInlineToolCalls', () => {
  it('returns no calls when the begin token is absent', () => {
    expect(parseDeepSeekInlineToolCalls('A plain assistant answer.')).toEqual([]);
    expect(parseDeepSeekInlineToolCalls('')).toEqual([]);
  });

  it('parses a single inline tool call', () => {
    const calls = parseDeepSeekInlineToolCalls(wrap(callBlock('read_file', '{"path": "app.js"}')));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      type: 'function',
      name: 'read_file',
      arguments: '{"path": "app.js"}',
    });
    expect(typeof calls[0]?.id).toBe('string');
  });

  it('parses parallel inline tool calls in order', () => {
    const calls = parseDeepSeekInlineToolCalls(
      wrap(callBlock('Read', '{"path":"a.js"}'), callBlock('Grep', '{"pattern":"foo"}')),
    );
    expect(calls.map((c) => c.name)).toEqual(['Read', 'Grep']);
    expect(calls.map((c) => c.arguments)).toEqual(['{"path":"a.js"}', '{"pattern":"foo"}']);
  });

  it('skips a call whose argument block is not valid JSON', () => {
    const calls = parseDeepSeekInlineToolCalls(
      wrap(callBlock('Read', '{"path": broken'), callBlock('Grep', '{"pattern":"x"}')),
    );
    expect(calls.map((c) => c.name)).toEqual(['Grep']);
  });
});

describe('DeepSeekInlineToolCallFilter', () => {
  it('passes ordinary text through and never suppresses', () => {
    const f = new DeepSeekInlineToolCallFilter();
    let out = f.push('Hello, ');
    out += f.push('world.');
    out += f.flush();
    expect(out).toBe('Hello, world.');
    expect(f.sawToolBlock).toBe(false);
  });

  it('emits text before the block and suppresses the tokens', () => {
    const f = new DeepSeekInlineToolCallFilter();
    const content = `Reading now. ${wrap(callBlock('read_file', '{"path":"a.js"}'))}`;
    let out = '';
    out += f.push(content);
    out += f.flush();
    expect(out).toBe('Reading now. ');
    expect(f.sawToolBlock).toBe(true);
    expect(f.content).toBe(content);
    expect(parseDeepSeekInlineToolCalls(f.content)).toHaveLength(1);
  });

  it('detects a begin marker split across deltas', () => {
    const f = new DeepSeekInlineToolCallFilter();
    const mid = Math.floor(DEEPSEEK_TOOL_CALLS_BEGIN.length / 2);
    let out = '';
    out += f.push(`ok ${DEEPSEEK_TOOL_CALLS_BEGIN.slice(0, mid)}`);
    out += f.push(`${DEEPSEEK_TOOL_CALLS_BEGIN.slice(mid)}rest`);
    out += f.flush();
    expect(out).toBe('ok ');
    expect(f.sawToolBlock).toBe(true);
  });

  it('flush is idempotent — a second call returns empty', () => {
    const f = new DeepSeekInlineToolCallFilter();
    f.push('held');
    expect(f.flush()).toBe('held');
    expect(f.flush()).toBe('');
  });

  it('suppresses a malformed block too (it has the begin token but no parseable call)', () => {
    const f = new DeepSeekInlineToolCallFilter();
    const malformed = `${DEEPSEEK_TOOL_CALLS_BEGIN}<|tool${SEP}call${SEP}begin|>function<|tool${SEP}sep|>read_file\n\`\`\`json\n{ broken`;
    let out = f.push(`note ${malformed}`);
    out += f.flush();
    expect(out).toBe('note ');
    expect(f.sawToolBlock).toBe(true);
    expect(parseDeepSeekInlineToolCalls(f.content)).toEqual([]);
  });
});

describe('OpenAILegacyStreamedMessage inline-tool fallback (non-stream)', () => {
  const nonStream = (content: string) =>
    new OpenAILegacyStreamedMessage(
      { id: 'cmpl_test', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] } as never,
      false,
      undefined,
    );
  const collect = async (sm: AsyncIterable<StreamedMessagePart>): Promise<StreamedMessagePart[]> => {
    const parts: StreamedMessagePart[] = [];
    for await (const part of sm) parts.push(part);
    return parts;
  };
  const textOf = (parts: StreamedMessagePart[]) =>
    parts
      .filter((p): p is Extract<StreamedMessagePart, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('');

  it('parses a leaked block into a function part and strips the tokens', async () => {
    const parts = await collect(nonStream(`Reading. ${wrap(callBlock('read_file', '{"path":"a.js"}'))}`));
    expect(textOf(parts)).toBe('Reading. ');
    const fns = parts.filter((p): p is Extract<StreamedMessagePart, { type: 'function' }> => p.type === 'function');
    expect(fns).toHaveLength(1);
    expect(fns[0]?.name).toBe('read_file');
  });

  it('strips the tokens of a malformed block even though no call is dispatched', async () => {
    const parts = await collect(
      nonStream(`Reading. ${DEEPSEEK_TOOL_CALLS_BEGIN}<|tool${SEP}call${SEP}begin|>function<|tool${SEP}sep|>read_file\n\`\`\`json\n{ broken`),
    );
    const text = textOf(parts);
    expect(text).toBe('Reading. ');
    expect(text).not.toContain(DEEPSEEK_TOOL_CALLS_BEGIN);
    expect(parts.some((p) => p.type === 'function')).toBe(false);
  });
});
