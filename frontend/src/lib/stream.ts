export type StreamEvent = {
  event: string;
  name: string;
  run_id: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
};

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function createEventParser(onEvent: (event: StreamEvent) => void) {
  let buffer = '';

  function dispatch(frame: string) {
    let type = '';
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!type && !data.length) return; // Comentários/keep-alives SSE.
    const payload = record(JSON.parse(data.join('\n')));
    if (!type || payload.event !== type || typeof payload.name !== 'string'
      || typeof payload.run_id !== 'string' || !payload.data
      || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
      throw new Error('A API enviou um evento SSE inválido.');
    }
    onEvent(payload as StreamEvent);
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      let boundary: RegExpMatchArray | null;
      while ((boundary = buffer.match(/\r?\n\r?\n/)) !== null) {
        const index = boundary.index!;
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + boundary[0].length);
        dispatch(frame);
      }
    },
    finish() {
      if (buffer.trim()) throw new Error('A conexão terminou antes de completar a resposta.');
    },
  };
}

export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createEventParser(onEvent);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.finish();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
