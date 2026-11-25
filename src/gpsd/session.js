// -----------------------------------------------------------------------------
// One TCP connection to gpsd (port 2947 by default), from the protocol as the
// official document describes it:
//
//   1. gpsd sends its VERSION banner at once: no banner within HELLO, or
//      another first line, and this is not gpsd ('not_gpsd'); a protocol
//      major other than 3 is refused ('protocol');
//   2. the session asks `?WATCH={"enable":true,"json":true};` (JSON reports,
//      never NMEA nor raw data) and hands every object to `onMessage`;
//   3. a connection silent for PROBE_AFTER (gpsd says nothing while no
//      receiver reports) is asked `?VERSION;`: no line within PROBE_ANSWER,
//      it is closed ('silent').
//
// Bounds: a line is at most LIMITS.LINE_BYTES (longer: dropped up to its
// newline), the connection reads at most LIMITS.BYTES_PER_SECOND (more:
// closed, 'flood'). One timer at a time, every delay finite. `close()` ends
// it without any callback; `onEnd(reason)` is called once otherwise.
// -----------------------------------------------------------------------------

import { createConnection } from 'node:net';
import { LIMITS, TIMEOUTS } from '../constants.js';
import { PROBE_REQUEST, WATCH_REQUEST, parseLine, readVersion } from './parse.js';

const NETWORK_REASONS = {
  ECONNREFUSED: 'refused',
  ENOTFOUND: 'unresolved',
  EAI_AGAIN: 'unresolved',
  EHOSTUNREACH: 'unreachable',
  ENETUNREACH: 'unreachable',
  ETIMEDOUT: 'timeout',
  ECONNRESET: 'closed',
  EPIPE: 'closed',
};

/** Splits a byte stream into lines (LF, an ending CR dropped), each bounded. */
export class LineReader {
  constructor(maxBytes = LIMITS.LINE_BYTES) {
    this.maxBytes = maxBytes;
    this.parts = [];
    this.size = 0;
    this.skipping = false;
    this.oversized = 0;
  }

  /** Feeds a chunk, returns the complete lines (strings). */
  push(chunk) {
    const lines = [];
    let start = 0;
    for (;;) {
      const nl = chunk.indexOf(0x0a, start);
      if (nl === -1) break;
      const piece = chunk.subarray(start, nl);
      if (this.skipping || this.size + piece.length > this.maxBytes) {
        if (!this.skipping) this.oversized += 1;
        this.skipping = false;
      } else {
        const line = this.size === 0 ? piece : Buffer.concat([...this.parts, piece]);
        let text = line.toString('utf8');
        if (text.endsWith('\r')) text = text.slice(0, -1);
        lines.push(text);
      }
      this.parts = [];
      this.size = 0;
      start = nl + 1;
    }
    const rest = chunk.subarray(start);
    if (rest.length > 0 && !this.skipping) {
      if (this.size + rest.length > this.maxBytes) {
        this.oversized += 1;
        this.skipping = true;
        this.parts = [];
        this.size = 0;
      } else {
        this.parts.push(Buffer.from(rest));
        this.size += rest.length;
      }
    }
    return lines;
  }
}

export class GpsdSession {
  /**
   * @param {object} o
   * @param {string} o.host
   * @param {number} o.port
   * @param {() => number} o.monotonic
   * @param {{ setTimeout: Function, clearTimeout: Function }} o.timers
   * @param {Function} [o.connect] net.createConnection (tests)
   * @param {(version: object) => void} [o.onWatching] the banner was read, ?WATCH sent
   * @param {(obj: object) => void} [o.onMessage] every object after the banner
   * @param {() => void} [o.onSilence] the connection was silent, gpsd is asked
   * @param {(reason: string) => void} [o.onEnd]
   */
  constructor({ host, port, monotonic, timers, connect = createConnection, ...handlers }) {
    this.host = host;
    this.port = port;
    this.monotonic = monotonic;
    this.timers = timers;
    this.connect = connect;
    this.handlers = handlers;
    this.phase = 'idle';
    this.ended = false;
    this.timer = null;
    this.socket = null;
    this.reader = new LineReader();
    this.lastLineAt = 0;
    this.windowStart = 0;
    this.windowBytes = 0;
    this.version = null;
    this.invalidLines = 0;
  }

  start() {
    if (this.phase !== 'idle' || this.ended) return;
    this.phase = 'connecting';
    let socket;
    try {
      socket = this.connect({ host: this.host, port: this.port });
    } catch {
      this.end('error');
      return;
    }
    this.socket = socket;
    socket.on('error', (err) => this.end(NETWORK_REASONS[err?.code] ?? 'error'));
    socket.on('close', () => this.end('closed'));
    socket.on('connect', () => {
      if (this.ended) return;
      socket.setNoDelay?.(true);
      socket.setKeepAlive?.(true, 30_000);
      this.phase = 'hello';
      this.arm(TIMEOUTS.HELLO, () => this.end('not_gpsd'));
    });
    socket.on('data', (chunk) => this.onData(chunk));
    this.arm(TIMEOUTS.CONNECT, () => this.end('timeout'));
  }

  /** Ends without calling onEnd (configuration changed, integration stopping). */
  close() {
    if (this.ended) return;
    this.ended = true;
    this.cleanup();
  }

  arm(ms, fn) {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    const delay = Math.min(Math.max(0, ms), TIMEOUTS.PROBE_AFTER);
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      if (!this.ended) fn();
    }, delay);
  }

  cleanup() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.phase = 'ended';
    try {
      this.socket?.destroy();
    } catch {
      // already gone
    }
  }

  end(reason) {
    if (this.ended) return;
    this.ended = true;
    this.cleanup();
    this.handlers.onEnd?.(reason);
  }

  onData(chunk) {
    if (this.ended) return;
    const mono = this.monotonic();
    if (mono - this.windowStart >= 1000) {
      this.windowStart = mono;
      this.windowBytes = 0;
    }
    this.windowBytes += chunk.length;
    if (this.windowBytes > LIMITS.BYTES_PER_SECOND) {
      this.end('flood');
      return;
    }
    for (const line of this.reader.push(chunk)) {
      if (this.ended) return;
      this.onLine(line, mono);
    }
  }

  onLine(line, mono) {
    this.lastLineAt = mono;
    const obj = parseLine(line);
    if (this.phase === 'hello') {
      const version = readVersion(obj);
      if (!version) {
        this.end('not_gpsd');
        return;
      }
      if (version.protoMajor !== 3) {
        this.version = version;
        this.end('protocol');
        return;
      }
      this.version = version;
      this.phase = 'watching';
      this.socket.write(WATCH_REQUEST);
      this.armIdle(mono);
      this.handlers.onWatching?.(version);
      return;
    }
    if (this.phase === 'probing') {
      this.phase = 'watching';
      this.armIdle(mono);
    }
    if (obj === null) {
      this.invalidLines += 1;
      return;
    }
    this.handlers.onMessage?.(obj);
  }

  /** Re-armed for the rest of the silence only when it fires (not per line). */
  armIdle(mono) {
    const wait = this.lastLineAt + TIMEOUTS.PROBE_AFTER - mono;
    this.arm(wait, () => {
      const now = this.monotonic();
      if (now - this.lastLineAt < TIMEOUTS.PROBE_AFTER) {
        this.armIdle(now);
        return;
      }
      this.phase = 'probing';
      this.socket.write(PROBE_REQUEST);
      this.arm(TIMEOUTS.PROBE_ANSWER, () => this.end('silent'));
      this.handlers.onSilence?.();
    });
  }
}
