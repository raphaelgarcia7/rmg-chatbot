import { record } from './stream.ts';
import type { StreamEvent } from './stream.ts';

type Progress = 'streaming' | 'complete' | 'interrupted';
export type TimelineItem =
  | { kind: 'model'; id: string; content: string; status: Progress }
  | { kind: 'tool_call'; id: string; name: string; args: unknown }
  | { kind: 'tool'; id: string; name: string; input: unknown; status: Progress }
  | { kind: 'tool_result'; id: string; name: string; output: unknown };

export function textContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((block) => {
    const item = record(block);
    return typeof item.text === 'string' ? item.text : '';
  }).join('');
}

export function toolOutput(value: unknown): unknown {
  const content = record(value).content;
  if (typeof content !== 'string') return value;
  try { return JSON.parse(content); } catch { return content; }
}

function renderChatModelEvent(items: TimelineItem[], event: StreamEvent): TimelineItem[] {
  const id = event.run_id;
  if (event.event === 'on_chat_model_start') {
    return [...items, { kind: 'model', id, content: '', status: 'streaming' }];
  }
  if (event.event === 'on_chat_model_stream') {
    const token = textContent(record(event.data.chunk).content);
    return items.map((item) => item.kind === 'model' && item.id === id
      ? { ...item, content: item.content + token } : item);
  }
  if (event.event === 'on_chat_model_end') {
    const output = record(event.data.output);
    const next: TimelineItem[] = items.map((item) => item.kind === 'model' && item.id === id
      ? { ...item, content: textContent(output.content), status: 'complete' } : item);
    const calls = Array.isArray(output.tool_calls) ? output.tool_calls : [];
    calls.forEach((value, index) => {
      const call = record(value);
      next.push({
        kind: 'tool_call', id: `${id}-call-${index}`,
        name: String(call.name ?? 'tool'), args: call.args,
      });
    });
    return next;
  }
  throw new Error(`Evento de modelo não suportado: ${event.event}`);
}

function renderToolEvent(items: TimelineItem[], event: StreamEvent): TimelineItem[] {
  if (event.event === 'on_tool_start') {
    return [...items, {
      kind: 'tool', id: event.run_id, name: event.name,
      input: event.data.input, status: 'streaming',
    }];
  }
  if (event.event === 'on_tool_end') {
    const next: TimelineItem[] = items.map((item) => item.kind === 'tool' && item.id === event.run_id
      ? { ...item, status: 'complete' } : item);
    return [...next, {
      kind: 'tool_result', id: `${event.run_id}-result`,
      name: event.name, output: toolOutput(event.data.output),
    }];
  }
  throw new Error(`Evento de tool não suportado: ${event.event}`);
}

export function renderEvent(items: TimelineItem[], event: StreamEvent): TimelineItem[] {
  if (event.event.startsWith('on_chat_model_')) return renderChatModelEvent(items, event);
  if (event.event.startsWith('on_tool_')) return renderToolEvent(items, event);
  throw new Error(`Evento não suportado: ${event.event}`);
}

export function interruptTimeline(items: TimelineItem[]): TimelineItem[] {
  return items.map((item) => 'status' in item && item.status === 'streaming'
    ? { ...item, status: 'interrupted' } : item);
}

export function isComplete(items: TimelineItem[]): boolean {
  const last = items.at(-1);
  return last?.kind === 'model' && last.status === 'complete'
    && !items.some((item) => 'status' in item && item.status === 'streaming');
}
