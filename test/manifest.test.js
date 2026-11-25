// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULTS } from '../src/config.js';
import { ACTIONS, FEATURES, PRECISIONS, PUBLISH_INTERVALS } from '../src/constants.js';
import { buildDevice } from '../src/devices.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const handlers = read('src/handlers.js');
const dockerfile = read('Dockerfile');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* texts(item, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

const keys = (list) => (list ?? []).map((item) => item.key);
const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
const SEMVER = /^\d+\.\d+\.\d+$/;

test('the store basics; version 0.1.0 set by hand everywhere, never pinned', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.gladys_version, '>=5.1.0', 'a range, never a pinned version');
  assert.match(manifest.version, SEMVER);
  for (const version of [pkg.version, lock.version, lock.packages[''].version]) {
    assert.equal(version, manifest.version);
  }
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-gpsd:${manifest.version}`);
  assert.equal(pkg.name, 'gladys-gpsd');
  assert.equal(lock.name, 'gladys-gpsd');
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk']);
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
  assert.deepEqual(manifest.transports, ['local']);
  assert.equal(manifest.location, undefined, 'the houses of Gladys are never read');
  assert.equal(manifest.countries, undefined, 'any country');
  assert.equal(manifest.keywords, undefined);
  assert.deepEqual(manifest.categories, ['vehicles', 'network']);
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(fields.intro.description.en, /Unofficial integration, not affiliated/);
  assert.match(fields.intro.description.fr, /non officielle, sans lien/);
  assert.match(read('docs/en.md'), /never been tested with a real receiver/i);
  assert.match(read('docs/fr.md'), /jamais été testée avec un vrai récepteur/i);
});

test('the license (no personal name) and the notices ship in the image', () => {
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/, 'the standard text');
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /gpsd/);
  assert.match(notices, /BSD-2-Clause/);
  assert.match(dockerfile, /COPY[^\n]*LICENSE[^\n]*THIRD_PARTY_NOTICES\.md/);
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration matches the code; no secret, no gladys_ key, never "encrypted"', () => {
  assert.deepEqual(keys(manifest.config_schema), [
    'intro',
    'host',
    'receiver',
    'publish_interval',
    'precision',
  ]);
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.publish_interval.options.map((o) => o.value),
    PUBLISH_INTERVALS,
  );
  assert.deepEqual(
    fields.precision.options.map((o) => o.value),
    PRECISIONS,
  );
  for (const field of manifest.config_schema) {
    assert.doesNotMatch(field.key, /^gladys_/i, field.key);
    assert.notEqual(field.type, 'secret', 'nothing secret here');
    if (field.options) {
      const values = field.options.map((o) => o.value);
      assert.equal(new Set(values).size, values.length, `${field.key}: unique values`);
      for (const option of field.options) {
        assert.equal(typeof option.value, 'string');
        assert.ok(option.label.en && option.label.fr);
      }
    }
  }
  assert.equal(fields.host.default, undefined);
  for (const [name, text] of [
    ['manifest', JSON.stringify(manifest)],
    ['docs/en.md', read('docs/en.md')],
    ['docs/fr.md', read('docs/fr.md')],
    ['README.md', read('README.md')],
  ]) {
    assert.doesNotMatch(text, /chiffr|encrypt/i, name);
  }
});

test('sections store nothing; links https', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined, section.key);
    assert.equal(section.default, undefined, section.key);
    assert.equal(section.placeholder, undefined, section.key);
    assert.ok(!(section.key in DEFAULTS), section.key);
    for (const link of section.links ?? []) assert.match(link.url, /^https:\/\//);
    for (const text of Object.values(section.description)) {
      assert.ok(text.length <= 1000, `${section.key}: ${text.length} characters`);
    }
  }
});

test('placeholders are multi-language objects', () => {
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', field.key);
    assert.ok(field.placeholder.en && field.placeholder.fr, field.key);
  }
});

test('the keys of the manifest are the keys of the code, all registered', () => {
  assert.deepEqual(keys(manifest.actions).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), name);
  }
  assert.ok(manifest.actions.every((a) => a.timeout_seconds >= 5 && a.timeout_seconds <= 120));
  assert.equal(manifest.scene_actions, undefined, 'read only: no scene action');
  assert.equal(manifest.scene_triggers, undefined);
  assert.equal(manifest.widgets, undefined);
  for (const handler of ['onScanRequest(', 'onSetValue(', 'onConfigUpdated(']) {
    assert.ok(handlers.includes(handler), handler);
  }
});

test('features: read only, no switch, pairs and units of the core; keys fixed', () => {
  const gladys = createFakeGladys({ selector: 'gpsd' });
  const { features } = buildDevice(gladys, { host: 'gps.lan', port: 2947 });
  // Units of DEVICE_FEATURE_UNITS_BY_CATEGORY (server/utils/constants.js of the core).
  const allowed = {
    unknown: { types: ['unknown'], units: [] },
    'distance-sensor': { types: ['decimal'], units: ['m'] },
    'speed-sensor': { types: ['decimal'], units: ['meter-per-second', 'kilometer-per-hour'] },
    'angle-sensor': { types: ['integer'], units: [] },
    'counter-sensor': { types: ['integer'], units: [] },
    text: { types: ['text'], units: [] },
  };
  for (const feature of features) {
    assert.equal(feature.read_only, true, feature.name);
    assert.equal(feature.has_feedback, false, feature.name);
    assert.ok(Number.isFinite(feature.min) && Number.isFinite(feature.max), feature.name);
    const rule = allowed[feature.category];
    assert.ok(
      rule?.types.includes(feature.type),
      `${feature.name}: ${feature.category}/${feature.type}`,
    );
    if (rule.units.length === 0) assert.equal(feature.unit, undefined, `${feature.name}: no unit`);
    else assert.ok(rule.units.includes(feature.unit), `${feature.name}: ${feature.unit}`);
    assert.notEqual(feature.category, 'switch');
    assert.notEqual(feature.type, 'binary');
  }
  assert.deepEqual(
    features.map((f) => f.external_id.split(':').at(-1)).sort(),
    Object.values(FEATURES).sort(),
  );
  const position = features.filter((f) =>
    ['latitude', 'longitude'].includes(f.external_id.split(':').at(-1)),
  );
  assert.ok(
    position.every((f) => f.keep_history === false),
    'no position history by default',
  );
});

test('supported_options: the rules of the core on every published one (none today)', () => {
  const gladys = createFakeGladys({ selector: 'gpsd' });
  const { features } = buildDevice(gladys, { host: 'gps.lan', port: 2947 });
  const core = new URL(
    '../../../Gladys/server/utils/normalizeSupportedOptions.js',
    import.meta.url,
  );
  const mod = existsSync(core) ? createRequire(import.meta.url)(core.pathname) : null;
  const normalize = typeof mod === 'function' ? mod : mod?.normalizeSupportedOptions;
  for (const feature of features) {
    if (feature.supported_options === undefined) continue;
    const values = feature.supported_options.map((o) => o.value);
    assert.equal(new Set(values).size, values.length);
    for (const option of feature.supported_options) {
      assert.deepEqual(Object.keys(option).sort(), ['label', 'value']);
      assert.equal(typeof option.label, 'string');
      assert.ok(option.label.length > 0 && option.label === option.label.trim());
      assert.ok(Number.isInteger(option.value) || typeof option.value === 'string');
    }
    if (typeof normalize === 'function') normalize(feature.supported_options);
  }
  assert.ok(features.every((f) => f.supported_options === undefined));
});
