// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';
import { DEFAULT_PORT, LIMITS, PRECISIONS, PUBLISH_INTERVALS } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = Object.freeze({
  publish_interval: '60',
  precision: '4',
});

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const HOSTNAME =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/** Addresses that are never one machine: any, broadcast, multicast. */
function isNeverAHost(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b, c, d] = ip.split('.').map(Number);
    if (a === 0) return true;
    if (a >= 224) return true; // multicast and reserved, broadcast included
    return a === 255 && b === 255 && c === 255 && d === 255;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    return lower === '::' || lower.startsWith('ff');
  }
  return false;
}

/**
 * The gpsd address: `host`, `host:port`, `[ipv6]`, `[ipv6]:port` or a bare
 * IPv6. -> { host, port } | { error: 'missing' | 'invalid' }.
 */
export function parseAddress(value) {
  const raw = text(value);
  if (!raw) return { error: 'missing' };
  if (raw.length > 270 || /[^\x21-\x7e]/.test(raw)) return { error: 'invalid' };
  let host = raw;
  let portText = null;
  const bracket = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(raw);
  if (bracket) {
    host = bracket[1];
    portText = bracket[2] ?? null;
    if (isIP(host) !== 6) return { error: 'invalid' };
  } else if (isIP(raw) === 6) {
    host = raw;
  } else {
    const colon = /^([^:]+):(\d{1,5})$/.exec(raw);
    if (colon) {
      host = colon[1];
      portText = colon[2];
    } else if (raw.includes(':')) {
      return { error: 'invalid' };
    }
    if (isIP(host) !== 4 && !HOSTNAME.test(host)) return { error: 'invalid' };
    // Four numbers that are not an IPv4 address (999.1.1.1): a typing error.
    if (isIP(host) !== 4 && /^[0-9.]+$/.test(host)) return { error: 'invalid' };
  }
  if (isNeverAHost(host)) return { error: 'invalid' };
  const port = portText === null ? DEFAULT_PORT : Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'invalid' };
  return { host: host.toLowerCase(), port };
}

/**
 * The receiver path (`/dev/ttyACM0`), empty for "the first one gpsd reports".
 * Compared with the `device` of the reports (never sent: a request of gpsd
 * is at most 80 characters, too short for a `/dev/serial/by-id/` path).
 * Printable ASCII without `"` or `\`.
 * -> { receiver: string | null } | { error: 'invalid' }.
 */
export function parseReceiver(value) {
  const raw = text(value);
  if (!raw) return { receiver: null };
  if (raw.length > LIMITS.PATH_CHARS || !/^[\x21-\x7e]+$/.test(raw) || /["\\]/.test(raw)) {
    return { error: 'invalid' };
  }
  return { receiver: raw };
}

export function normalizeConfig(raw = {}) {
  raw = raw ?? {};
  const pick = (key, list) => (list.includes(String(raw[key])) ? String(raw[key]) : DEFAULTS[key]);
  const address = parseAddress(raw.host);
  const receiver = parseReceiver(raw.receiver);
  return {
    host: address.error ? null : address.host,
    port: address.error ? null : address.port,
    addressError: address.error ?? null,
    receiver: receiver.error ? null : receiver.receiver,
    receiverInvalid: Boolean(receiver.error),
    publishSeconds: Number(pick('publish_interval', PUBLISH_INTERVALS)),
    decimals: Number(pick('precision', PRECISIONS)),
  };
}

/** Same gpsd target (a change of these starts a new connection). */
export const sameTarget = (a, b) =>
  Boolean(a && b) && a.host === b.host && a.port === b.port && a.receiver === b.receiver;
