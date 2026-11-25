// -----------------------------------------------------------------------------
// The integration: one gpsd connection, its reports turned into the states of
// one Gladys device, published at a bounded pace.
//
// Pace: the reports of gpsd (about one per second) only replace the last one
// kept; a round publishes the newest TPV and SKY received since the round
// before, at most once per publication interval (the first one at once), and
// only the values that changed (publishChangedStates, re-sent once an hour
// when unchanged). Nothing old is published again: a round without a new
// report publishes nothing, and the reports kept are dropped when the
// connection ends.
//
// Time: `monotonic` paces everything (rounds, retries, silences); the wall
// clock decides nothing. Every timer has a finite delay, one per flow
// (publication, retry, configuration, the session's own), all cleared by stop().
// -----------------------------------------------------------------------------

import { DEFAULT_PORT, INTERVALS, LIMITS, MODES } from './constants.js';
import { normalizeConfig, sameTarget } from './config.js';
import { buildDevice, deviceIds, receiverKey } from './devices.js';
import { T, join } from './i18n.js';
import { readDevice, readDevices, readError, readSky, readTpv } from './gpsd/parse.js';
import { GpsdSession } from './gpsd/session.js';
import { buildStates, fixText, mergeTpv } from './report.js';

const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };

const defaultTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
};

const backoff = (failures, min, max) => Math.min(max, min * 2 ** Math.min(20, failures - 1));

export class GpsdApp {
  constructor({
    gladys,
    logger = quietLogger,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    connect,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.monotonic = monotonic;
    this.timers = timers;
    this.connect = connect;
    this.config = null;
    this.stopped = false;
    this.gen = 0;
    this.session = null;
    this.sessionGen = 0;
    this.failures = 0;
    this.configFailures = 0;
    this.retryTimer = null;
    this.retryAt = null;
    this.configTimer = null;
    this.publishTimer = null;
    this.statusTimer = null;
    this.publishing = false;
    this.lastPublishAt = null;
    this.lastReason = null;
    this.status = { key: null, at: null, chain: Promise.resolve() };
    this.resetReports();
  }

  // --- Lifecycle -------------------------------------------------------------------

  /** On every connection to Gladys: read the configuration (retried without end). */
  async startFromGladys() {
    this.stopped = false;
    const gen = ++this.gen;
    this.clearTimer('configTimer');
    // Gladys may have lost what was published while away: the next fresh
    // report is sent whole (never an old one again).
    this.gladys.forgetPublishedStates?.();
    this.status.key = null;
    let raw;
    try {
      raw = await this.gladys.getConfig();
    } catch (err) {
      if (gen !== this.gen || this.stopped) return;
      this.configFailures += 1;
      const delay = backoff(
        this.configFailures,
        INTERVALS.CONFIG_RETRY_MIN_MS,
        INTERVALS.CONFIG_RETRY_MAX_MS,
      );
      this.logger.warn(
        `Configuration unreadable (${err?.message ?? err}), next try in ${delay} ms`,
      );
      this.setStatus('config', false, T.configUnreadable(delay));
      this.configTimer = this.timers.setTimeout(() => {
        this.configTimer = null;
        if (gen === this.gen && !this.stopped) this.startFromGladys();
      }, delay);
      return;
    }
    if (gen !== this.gen || this.stopped) return;
    this.configFailures = 0;
    await this.apply(raw);
  }

  /** The configuration saved by the user. */
  async configUpdated(raw) {
    this.stopped = false;
    this.gen += 1;
    this.clearTimer('configTimer');
    this.configFailures = 0;
    await this.apply(raw);
  }

  async apply(raw) {
    const gen = this.gen;
    const previous = this.config;
    const config = normalizeConfig(raw);
    this.config = config;
    if (config.addressError || config.receiverInvalid) {
      this.stopSession();
      this.clearTimer('retryTimer');
      const message =
        config.addressError === 'missing'
          ? T.addressMissing
          : config.addressError
            ? T.addressInvalid
            : T.receiverInvalid;
      this.setStatus(`config:${config.addressError ?? 'receiver'}`, false, message);
      return;
    }
    await this.publishDiscovery();
    if (gen !== this.gen || this.stopped) return;
    const running = this.session !== null || this.retryTimer !== null;
    if (!running || !sameTarget(previous, config)) {
      // Another gpsd or receiver: a new connection at once, a clean slate.
      this.failures = 0;
      this.stopSession();
      this.clearTimer('retryTimer');
      this.openSession();
      return;
    }
    // Same target: the connection goes on; the pace may have changed.
    this.status.key = null;
    this.refreshStatus();
    if (this.publishTimer !== null) {
      this.clearTimer('publishTimer');
      this.schedulePublish();
    }
  }

  async stop() {
    this.stopped = true;
    this.gen += 1;
    this.clearTimer('configTimer');
    this.clearTimer('retryTimer');
    this.clearTimer('publishTimer');
    this.clearTimer('statusTimer');
    this.stopSession();
    await this.status.chain;
  }

  clearTimer(name) {
    if (this[name] !== null) this.timers.clearTimeout(this[name]);
    this[name] = null;
    if (name === 'retryTimer') this.retryAt = null;
  }

  // --- Discovery and commands ------------------------------------------------------

  /** The device of the configured gpsd ([] without a valid address). */
  devices() {
    if (!this.config?.host) return [];
    return [buildDevice(this.gladys, { host: this.config.host, port: this.config.port })];
  }

  async publishDiscovery() {
    try {
      await this.gladys.publishDiscoveredDevices(this.devices());
    } catch (err) {
      this.logger.warn(`Discovery not published: ${err?.message ?? err}`);
    }
  }

  async setValue() {
    throw new Error(T.readOnly.en);
  }

  // --- The gpsd connection ---------------------------------------------------------

  target() {
    const { host, port } = this.config;
    const shown = host.includes(':') ? `[${host}]` : host;
    return port === DEFAULT_PORT ? shown : `${shown}:${port}`;
  }

  resetReports() {
    this.version = null;
    this.watchingSince = null;
    this.lockedPath = null;
    this.otherPaths = new Set();
    this.receivers = new Map();
    this.lastTpv = null;
    this.tpvAt = null;
    this.lastSky = null;
    this.pendingTpv = null;
    this.pendingSky = null;
    this.silent = false;
    this.sawDevices = false;
  }

  openSession() {
    if (this.stopped || !this.config?.host) return;
    // The reports are dropped where a connection ends (onEnd, stopSession).
    const sessionGen = ++this.sessionGen;
    const mine = () => sessionGen === this.sessionGen && !this.stopped;
    const session = new GpsdSession({
      host: this.config.host,
      port: this.config.port,
      monotonic: this.monotonic,
      timers: this.timers,
      connect: this.connect,
      onWatching: (version) => mine() && this.onWatching(version),
      onMessage: (obj) => mine() && this.onMessage(obj),
      onSilence: () => mine() && this.onSilence(),
      onEnd: (reason) => mine() && this.onEnd(reason),
    });
    this.session = session;
    this.setStatus('connecting', false, T.connecting(this.target()));
    session.start();
  }

  stopSession() {
    this.sessionGen += 1;
    this.session?.close();
    this.session = null;
    this.clearTimer('publishTimer');
    this.clearTimer('statusTimer');
    this.resetReports();
  }

  onWatching(version) {
    this.version = version;
    this.watchingSince = this.monotonic();
    this.lastReason = null;
    this.logger.info(
      `Connected to gpsd ${version.release ?? '?'} (protocol ${version.protoMajor}.${version.protoMinor})`,
    );
    this.refreshStatus();
  }

  onEnd(reason) {
    const mono = this.monotonic();
    const lived = this.watchingSince !== null && mono - this.watchingSince >= INTERVALS.STABLE_MS;
    this.session = null;
    this.clearTimer('publishTimer');
    this.clearTimer('statusTimer');
    this.resetReports();
    this.failures = lived ? 1 : this.failures + 1;
    this.lastReason = reason;
    const delay = backoff(this.failures, INTERVALS.RETRY_MIN_MS, INTERVALS.RETRY_MAX_MS);
    this.logger.warn(`gpsd connection ended (${reason}), next try in ${delay} ms`);
    this.retryAt = mono + delay;
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      this.retryAt = null;
      if (!this.stopped && this.session === null) this.openSession();
    }, delay);
    this.setStatus(`failed:${reason}:${this.failures}`, false, T.failed(reason, delay));
  }

  onSilence() {
    this.silent = true;
    this.refreshStatus();
  }

  /** A report of the receiver followed (the configured one, else the first seen). */
  follows(path) {
    if (path === null) return true;
    const wanted = this.config.receiver ?? this.lockedPath;
    if (wanted === null) {
      this.lockedPath = path;
      return true;
    }
    if (path === wanted) return true;
    if (this.otherPaths.size < LIMITS.OTHER_RECEIVERS) this.otherPaths.add(path);
    return false;
  }

  onMessage(obj) {
    switch (obj.class) {
      case 'TPV': {
        const tpv = readTpv(obj);
        if (!tpv) return;
        if (!this.follows(tpv.path)) {
          this.refreshStatus();
          return;
        }
        this.silent = false;
        // A mode 0 says nothing: kept for nothing, published as nothing.
        if (tpv.mode === MODES.UNKNOWN) {
          this.refreshStatus();
          return;
        }
        // gpsd sends several TPV per epoch, some without the course or the
        // speed: a value missing from this one is taken from the reports of
        // the last TPV_CARRY_MS of the same fix (never across a loss of fix).
        const merged = mergeTpv(
          this.lastTpv ? { tpv: this.lastTpv, at: this.tpvAt } : null,
          tpv,
          this.monotonic(),
          INTERVALS.TPV_CARRY_MS,
        );
        this.lastTpv = merged.tpv;
        this.tpvAt = merged.at;
        this.pendingTpv = merged.tpv;
        this.schedulePublish();
        this.refreshStatus();
        return;
      }
      case 'SKY': {
        const sky = readSky(obj);
        if (!sky || !this.follows(sky.path)) return;
        this.silent = false;
        // gpsd 3.25 sends SKY objects with `uSat` only between the full ones:
        // a count it does not give keeps the last one it gave.
        const merge = (before) => ({
          used: sky.used ?? before?.used ?? null,
          seen: sky.seen ?? before?.seen ?? null,
        });
        this.lastSky = merge(this.lastSky);
        this.pendingSky = merge(this.pendingSky);
        this.schedulePublish();
        return;
      }
      case 'DEVICES': {
        const list = readDevices(obj) ?? [];
        this.sawDevices = true;
        this.receivers = new Map(list.filter((d) => d.path).map((d) => [d.path, d.active]));
        this.refreshStatus();
        return;
      }
      case 'DEVICE': {
        const device = readDevice(obj);
        if (!device?.path) return;
        this.sawDevices = true;
        if (this.receivers.size < LIMITS.OTHER_RECEIVERS * 2 || this.receivers.has(device.path)) {
          this.receivers.set(device.path, device.active);
        }
        // The followed receiver went away (unplugged): its last fix is no
        // longer the state of anything, and nothing of it is published.
        if (!device.active && device.path === (this.config.receiver ?? this.lockedPath)) {
          // Without a configured receiver, the next one that reports is followed.
          if (!this.config.receiver) {
            this.lockedPath = null;
            this.otherPaths.clear();
          }
          this.lastTpv = null;
          this.tpvAt = null;
          this.lastSky = null;
          this.pendingTpv = null;
          this.pendingSky = null;
        }
        this.refreshStatus();
        return;
      }
      case 'ERROR':
        this.logger.warn(`gpsd error: ${readError(obj)}`);
        return;
      default:
    }
  }

  // --- Publication -----------------------------------------------------------------

  schedulePublish() {
    if (this.stopped || this.publishTimer !== null || this.publishing) return;
    const interval = this.config.publishSeconds * 1000;
    const mono = this.monotonic();
    const wait =
      this.lastPublishAt === null
        ? 0
        : Math.min(interval, Math.max(0, this.lastPublishAt + interval - mono));
    this.publishTimer = this.timers.setTimeout(() => {
      this.publishTimer = null;
      this.publishRound();
    }, wait);
  }

  async publishRound() {
    if (this.stopped || this.publishing || !this.config?.host) return;
    const tpv = this.pendingTpv;
    const sky = this.pendingSky;
    if (!tpv && !sky) return;
    this.pendingTpv = null;
    this.pendingSky = null;
    this.lastPublishAt = this.monotonic();
    const ids = deviceIds(this.gladys, receiverKey(this.config.host, this.config.port));
    const states = buildStates(ids, { tpv, sky }, this.config.decimals);
    if (states.length === 0) return;
    this.publishing = true;
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: INTERVALS.HEARTBEAT_MS });
    } catch (err) {
      // Never the values (a position) in the logs: only how many.
      this.logger.warn(`${states.length} states not published: ${err?.message ?? err}`);
    } finally {
      this.publishing = false;
    }
    if (this.pendingTpv || this.pendingSky) this.schedulePublish();
  }

  // --- Status ----------------------------------------------------------------------

  /** One setConnectionStatus per state, in order; a failure is only logged. */
  setStatus(key, connected, message) {
    if (this.status.key === key) return;
    this.status.key = key;
    this.status.at = this.monotonic();
    this.status.chain = this.status.chain
      .then(() => this.gladys.setConnectionStatus(connected, message))
      .catch((err) => this.logger.warn(`Status not sent: ${err?.message ?? err}`));
  }

  /**
   * The status of a watching connection, from what gpsd reported, at most one
   * per INTERVALS.STATUS_MIN_GAP_MS (a fix that comes and goes ten times a
   * second sends one status, then the state of the end of the gap). The
   * connection failures are not delayed (their pace is the retries').
   */
  refreshStatus() {
    if (!this.session || !this.version) return;
    const wanted = this.watchingStatus();
    if (wanted.key === this.status.key) return;
    const mono = this.monotonic();
    const since = this.status.at === null ? Infinity : mono - this.status.at;
    if (since >= INTERVALS.STATUS_MIN_GAP_MS || !this.status.key?.startsWith('w:')) {
      this.clearTimer('statusTimer');
      this.setStatus(wanted.key, true, wanted.message);
      return;
    }
    if (this.statusTimer !== null) return;
    const wait = Math.min(
      INTERVALS.STATUS_MIN_GAP_MS,
      Math.max(0, INTERVALS.STATUS_MIN_GAP_MS - since),
    );
    this.statusTimer = this.timers.setTimeout(() => {
      this.statusTimer = null;
      if (!this.stopped) this.refreshStatus();
    }, wait);
  }

  /** The watching status: { key (prefixed `w:`), message }. */
  watchingStatus() {
    const release = this.version.release ?? '';
    const wanted = this.config.receiver ?? this.lockedPath;
    const others = [...this.otherPaths].join(', ');
    const anyActive = [...this.receivers.values()].some(Boolean);
    // The kind of fix (2D, 3D, DGPS) is never in the status: it may change
    // every second. The test button tells it.
    if (this.silent) return { key: 'w:silent', message: T.silent(release) };
    if (this.lastTpv && this.lastTpv.mode >= MODES.FIX_2D) {
      return { key: 'w:fix', message: T.fix(release) };
    }
    if (this.lastTpv) return { key: 'w:nofix', message: T.noFix(release) };
    if (this.config.receiver && others) {
      return { key: `w:notseen:${others}`, message: T.receiverNotSeen(release, wanted, others) };
    }
    if (this.sawDevices && !anyActive)
      return { key: 'w:noreceiver', message: T.noReceiver(release) };
    return { key: 'w:waiting', message: T.waiting(release) };
  }

  /** The answer of the test button: the state of the connection, never a coordinate. */
  testConnection() {
    if (!this.config?.host) {
      return this.config?.addressError === 'invalid' ? T.addressInvalid : T.addressMissing;
    }
    if (this.config.receiverInvalid) return T.receiverInvalid;
    const parts = [];
    if (this.session && this.version) {
      const release = this.version.release ?? '';
      if (this.lastTpv && this.lastTpv.mode >= MODES.FIX_2D) {
        parts.push(T.fixKind(release, fixText(this.lastTpv.mode, this.lastTpv.status)));
      } else if (this.lastTpv) {
        parts.push(T.noFix(release));
      } else {
        parts.push(T.waiting(release));
      }
      if (this.lastSky) parts.push(T.testSatellites(this.lastSky.used, this.lastSky.seen));
      if (this.otherPaths.size > 0) parts.push(T.testOthers([...this.otherPaths].join(', ')));
    } else if (this.session) {
      parts.push(T.connecting(this.target()));
    } else if (this.lastReason && this.retryAt !== null) {
      parts.push(T.failed(this.lastReason, Math.max(0, this.retryAt - this.monotonic())));
    } else {
      parts.push(T.connecting(this.target()));
    }
    parts.push(T.testPublishing(this.config.publishSeconds, this.config.decimals));
    return join(...parts);
  }
}
