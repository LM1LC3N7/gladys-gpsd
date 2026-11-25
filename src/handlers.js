// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so the
// tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  gladys.onScanRequest(() => app.publishDiscovery());

  // Read only: every command is refused with a clear message.
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // The state of the connection, from what it already knows: never a new
  // connection, never faster than the publication interval.
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());

  // Another gpsd or receiver: a new connection at once; the same one goes on.
  gladys.onConfigUpdated((config) => {
    logger?.info('Configuration updated');
    return app.configUpdated(config);
  });

  // Every connection to Gladys: configuration read again (retried without end),
  // status and Discovery sent again. The gpsd connection is kept while Gladys
  // is away: a failed publication is sent again by the next round.
  gladys.on('connected', async () => {
    try {
      await app.startFromGladys();
    } catch (err) {
      logger?.error('Start failed', err);
    }
  });
}
