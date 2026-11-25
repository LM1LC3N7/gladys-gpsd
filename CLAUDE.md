# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "pace"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (src/handlers.js registers every handler before connect())
src/app.js                        GpsdApp: one gpsd connection, pace of the publications, status, retries
src/gpsd/session.js               one TCP connection: VERSION banner, ?WATCH, probe after a silence, bounds
src/gpsd/parse.js                 gpsd JSON objects (TPV, SKY, DEVICE(S), ERROR, VERSION) -> plain values
src/report.js                     reports -> states (rounding of the position, units)
src/devices.js                    the device (pure); never fewer features than the created one
src/config.js                     DEFAULTS (mirror the manifest) + normalization of the address and receiver
src/i18n.js                       status and test-button texts (en, fr), never a coordinate
gladys-assistant-integration.json manifest
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test: fake Gladys, scripted gpsd socket, kit (TCP fakes, clocks)
scripts/mutants.{mjs,json}        mutation check of the guards (not in the CI, not in the image)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## gpsd specifics

- Written from the official "gpsd JSON protocol" document only: never copy nor
  port code of gpsd or of its client libraries (BSD-2-Clause, but the rule of
  the project is "protocol only").
- A position is personal data: never log, put in a status, an error or `/data`
  a coordinate; round it before publication (precision option).
- Only the newest report is kept; a round publishes at most once per interval
  and never an old report again. Unknown stays unknown (never 0).
- Monotonic clock only; every timer finite and cleared by `stop()`.

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **Every feature carries `name`, `min`, `max`, `read_only` and
  `has_feedback`**, even where they mean nothing: Gladys stores them NOT NULL.
  `min`/`max` are `0`/`1` for a binary feature, the real range for a numeric
  one, `0`/`0` for a feature without a range (text, image...). A missing one
  can pass the publication on a core that does not check it, then fail when
  the user clicks "Add" (HTTP 422 `t_device_feature.min cannot be null`). The
  SDK's fake Gladys refuses it on publication, and `test/manifest.test.js`
  checks them.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
