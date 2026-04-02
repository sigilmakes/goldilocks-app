/**
 * Bridge — JSONL RPC communication with a `pi --mode rpc` process.
 *
 * The Bridge is the ONLY code that talks to pi. It handles:
 *   - JSONL line parsing with buffering
 *   - RPC request/response correlation with timeouts
 *   - Event dispatch to subscribers (text deltas, tool calls, etc.)
 *   - message_end fallback text extraction (when no streaming deltas arrive)
 *   - Structured file logging of all I/O
 *
 * The Bridge knows NOTHING about k8s, HTTP, WebSocket, or auth.
 * It takes a readable stream (stdout from pi) and a writable stream (stdin to pi).
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { appendFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Event emitted by the pi RPC process. */
export interface BridgeEvent {
  type: string;
  [key: string]: unknown;
}

/** Callback for Bridge events. */
export type BridgeEventHandler = (event: BridgeEvent) => void;

export interface BridgeOptions {
  /** User ID — used for log file naming. */
  userId: string;
  /** Directory for log files. */
  logDir: string;
  /** Writable stream to pi's stdin. */
  stdin: NodeJS.WritableStream;
  /** Readable stream from pi's stdout. */
  stdout: NodeJS.ReadableStream;
  /** Readable stream from pi's stderr (optional, logged). */
  stderr?: NodeJS.ReadableStream;
  /** Called when the underlying process exits or the streams close. */
  onExit?: (reason: string) => void;
}

interface PendingRpc {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export class Bridge extends EventEmitter {
  private stdin: NodeJS.WritableStream;
  private buffer = '';
  private pending = new Map<string, PendingRpc>();
  private subscribers = new Set<BridgeEventHandler>();
  private logFile: string;
  private closed = false;
  private userId: string;

  constructor(opts: BridgeOptions) {
    super();
    this.stdin = opts.stdin;
    this.userId = opts.userId;

    // Set up log file
    try { mkdirSync(opts.logDir, { recursive: true }); } catch { /* exists */ }
    this.logFile = resolve(opts.logDir, `bridge-${opts.userId}.log`);

    // Read stdout as JSONL
    opts.stdout.on('data', (chunk: Buffer | string) => {
      this.buffer += typeof chunk === 'string' ? chunk : chunk.toString();
      this.consumeLines();
    });

    opts.stdout.on('end', () => {
      this.log('INFO', 'stdout ended');
      this.handleExit('stdout ended');
    });

    opts.stdout.on('error', (err) => {
      this.log('ERROR', `stdout error: ${err.message}`);
      this.handleExit(`stdout error: ${err.message}`);
    });

    // Log stderr line by line
    if (opts.stderr) {
      let stderrBuf = '';
      opts.stderr.on('data', (chunk: Buffer | string) => {
        stderrBuf += typeof chunk === 'string' ? chunk : chunk.toString();
        const lines = stderrBuf.split('\n');
        stderrBuf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) this.log('STDERR', line.trim());
        }
      });
    }

    // Store exit callback
    if (opts.onExit) {
      this.on('exit', opts.onExit);
    }

    this.log('INFO', 'Bridge created');
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Send an RPC command and wait for the response.
   * Returns the response data on success, throws on error/timeout.
   */
  async rpc(type: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<unknown> {
    if (this.closed) throw new Error('Bridge is closed');

    const id = randomUUID();
    const line = JSON.stringify({ id, type, ...params });

    this.log('SEND', `${type} id=${id.slice(0, 8)} ${JSON.stringify(params)}`);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout for ${type} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.stdin.write(line + '\n');
    });
  }

  /**
   * Send a prompt and wait for agent_end.
   * Events (text_delta, tool calls, etc.) are dispatched to subscribers during the wait.
   * Returns the accumulated response text.
   */
  async prompt(text: string, images?: Array<{ type: string; data: string; mimeType: string }>): Promise<string> {
    if (this.closed) throw new Error('Bridge is closed');

    let responseText = '';

    // Set up event tracking for this prompt
    const agentDone = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Prompt timed out waiting for agent_end (5 min)'));
      }, 5 * 60 * 1000);

      const onEvent = (event: BridgeEvent) => {
        // Accumulate text deltas
        if (event.type === 'message_update') {
          const delta = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
          if (delta?.type === 'text_delta' && delta.delta) {
            responseText += delta.delta;
          }
        }

        // Fallback: extract text from message_end if no deltas arrived
        if (event.type === 'message_end') {
          const msg = event.message as { role?: string; content?: Array<{ type: string; text?: string }> } | undefined;
          if (msg?.role === 'assistant' && !responseText) {
            const textBlocks = Array.isArray(msg.content)
              ? msg.content.filter((b) => b.type === 'text')
              : [];
            const text = textBlocks.map((b) => b.text ?? '').join('');
            if (text) {
              responseText = text;
            }
          }
        }

        // Done
        if (event.type === 'agent_end') {
          cleanup();
          resolve(responseText.trim());
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.off('_internal_event', onEvent);
      };

      this.on('_internal_event', onEvent);
    });

    // Send the prompt RPC
    const rpcParams: Record<string, unknown> = {
      message: text,
      streamingBehavior: 'followUp',
    };
    if (images && images.length > 0) {
      rpcParams.images = images;
    }

    const response = await this.rpc('prompt', rpcParams);
    if (response && typeof response === 'object' && (response as Record<string, unknown>).success === false) {
      throw new Error((response as Record<string, unknown>).error as string ?? 'Prompt failed');
    }

    return agentDone;
  }

  /**
   * Subscribe to all events from pi.
   * Returns an unsubscribe function.
   */
  subscribe(handler: BridgeEventHandler): () => void {
    this.subscribers.add(handler);
    return () => { this.subscribers.delete(handler); };
  }

  /**
   * Send an abort command (best-effort).
   */
  async abort(): Promise<void> {
    try {
      await this.rpc('abort', {}, 5_000);
    } catch (err) {
      this.log('WARN', `Abort failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Close the bridge and clean up.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    // Reject all pending RPCs
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Bridge closed'));
    }
    this.pending.clear();
    this.subscribers.clear();

    this.log('INFO', 'Bridge closed');
    this.emit('exit', 'closed');
    this.removeAllListeners();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private consumeLines(): void {
    while (true) {
      const idx = this.buffer.indexOf('\n');
      if (idx === -1) break;
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line) this.onLine(line);
    }
  }

  private onLine(line: string): void {
    let event: BridgeEvent;
    try {
      event = JSON.parse(line);
    } catch {
      this.log('WARN', `Non-JSON line: ${line.slice(0, 200)}`);
      return;
    }

    const dataPreview = event.type === 'response' && event.data
      ? ` data=${JSON.stringify(event.data).slice(0, 200)}`
      : '';
    this.log('RECV', `type=${event.type}${event.id ? ` id=${String(event.id).slice(0, 8)}` : ''}${dataPreview}`);

    // RPC response — resolve pending promise
    if (event.type === 'response' && event.id && this.pending.has(event.id as string)) {
      const pending = this.pending.get(event.id as string)!;
      this.pending.delete(event.id as string);
      clearTimeout(pending.timer);
      if (event.success) {
        pending.resolve(event.data);
      } else {
        pending.reject(new Error((event.error as string) ?? 'RPC error'));
      }
      return;
    }

    // Emit internal event for prompt() tracking
    this.emit('_internal_event', event);

    // Dispatch to all subscribers
    for (const handler of this.subscribers) {
      try {
        handler(event);
      } catch (err) {
        this.log('ERROR', `Subscriber error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private handleExit(reason: string): void {
    if (this.closed) return;
    this.close();
  }

  private log(level: string, msg: string): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] [bridge:${this.userId}] ${msg}`;

    // Console output
    if (level === 'ERROR') {
      console.error(line);
    } else {
      console.log(line);
    }

    // File output
    try {
      appendFileSync(this.logFile, line + '\n');
    } catch {
      // If we can't log to file, console is enough
    }
  }
}
