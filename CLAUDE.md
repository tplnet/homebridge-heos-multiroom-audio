# @tplnet/homebridge-heos-multiroom-audio

Maintained fork of hov3rcraft/homebridge-denon-heos-audio, renamed to "Homebridge HEOS Multiroom-Audio (tplnet)" (npm `@tplnet/homebridge-heos-multiroom-audio`, repo `tplnet/homebridge-heos-multiroom-audio`; formerly `@tplnet/homebridge-denon-heos-audio`), platform name `HeosMultiroomAudio` (up to 1.x `DenonHeosAudio`, still accepted with a warning). Controls Denon / Marantz HEOS speakers, the Denon Home Amp and AV receivers from Apple Home. License GPL-3.0 (from the original project).

## Commands
- `npm run lint`, `npm run build`, `npm test` (builds and runs the unit tests in `test/unit`, no device needed)
- `npm run smoke` – starts Homebridge with simulated HEOS (port 1255) and AVR Control (port 23) devices (compatibility check)
- `npm run check` – everything: `npm audit`, lint, unit tests, smoke test (also runs as `preversion`)
- Other Homebridge versions: `npm install --no-save homebridge@1` / `homebridge@beta`, then `npm test && node scripts/smoke-test.mjs`
- Preview release notes: `node scripts/release-notes.mjs [version]`

## Project rules
- Every device is an external accessory (TV category, one per device, `api.publishExternalAccessories`), because Apple Home allows only one TV per bridge. The TelevisionSpeaker service is linked to the Television service.
- Stable ports: the devices of the start (manual ones and the ones discovered within the first 10 s) are published in one call, sorted by serial number; Homebridge assigns the ports in publish order. Don't publish them one by one again.
- Control protocols: HEOS CLI (TCP 1255, JSON, player ids can be negative), AVR Control (TCP 23) and Hybrid (power via AVR Control, the rest via HEOS CLI). The configured protocol is checked against the open ports at startup.
- Discovery: own SSDP implementation (`src/heosDiscovery.ts`, search target `urn:schemas-denon-com:device:ACT-Denon:1`); device descriptions are only fetched from the device that answered. Manually configured devices always win over automatically added ones.
- Settings page: `customUi` (`homebridge-ui/server.js` searches with `dist/heosDiscovery.js` / `checkProtocolSupport` and pushes each device; `homebridge-ui/public/overview.js` holds the status logic – it must follow the rules of `src/platform.ts` (manual > excluded > auto-add, `discoveryEnabled()`) – and the EN/DE texts; `index.html`: tab *Settings* = schema form, tab *Devices in the network* = overview; the search starts only when that tab is opened – no network search just by opening the settings, matching `deviceDiscovery` off by default; the Homebridge UI always puts the schema form below the custom page, hence tabs). Checked in a local Homebridge UI 5.30.1 with Playwright (fake SSDP devices). The page only changes the config in the form; saving stays with the user.
- Log: the device overview table (~30 s after the start) is the normal-level summary; details per discovered device only in the debug log.
- German settings form (the exception in the language rule below): `schemas/config.schema.de.json` shown when the Homebridge UI language is "Deutsch". It must have the same fields, defaults and limits as `config.schema.json` (checked by `test/unit/configSchema.test.js`).
- The plugin collects no data and only talks to devices in the local network (README "Privacy"); keep it that way.
- Never put real test data (device names such as the maintainer's room names, serial numbers, IP addresses, HEOS player ids) into the repository, tests or docs; use invented values (e.g. `192.0.2.x`, `BLT012345678`).
- **Beta first, release on request:** every change is published as a beta first (`X.Y.Z-beta.N`, npm dist-tag `beta`, pre-release on GitHub; see docs/releasing.md). A regular release (`X.Y.Z`, `latest`) is only made when Timo asks for it. While unreleased betas exist, ask him regularly (e.g. after he reports test results, or when a session starts or ends) whether a release should be made.
- The platform name is `HeosMultiroomAudio` since 2.0.0 (Timo's decision 2026-11-23, suggested in the verification review: the old name clashed with the original plugin). The old name `DenonHeosAudio` is still registered (`LegacyDenonAudioPlatform`, logs a warning) so 1.x configurations keep working. **Timo wants it removed in a future version** (2026-11-23) – that is a breaking change (configurations still using `DenonHeosAudio` stop loading), so do it in a major version and say so prominently in CHANGELOG / release notes; agree the version with Timo first. Don't change the platform name again.
- Name and search: "Denon" and "Marantz" must stay findable (npm description and keywords, GitHub topics/About, README intro).
- Default branch is `main` (not `master`). CHANGELOG headings before 1.3.3 have no date; new ones use `## X.Y.Z (YYYY-MM-DD)`.

## Rules for all tplnet Homebridge projects

These apply to `@tplnet/homebridge-tahoma` and `@tplnet/homebridge-heos-multiroom-audio` (`@tplnet/overkiz-client` and `homebridge-tahoma-local` are archived since 2026-11-23). Keep the projects consistent: a change to the release or check process in one of them goes into all of them. New tplnet projects adopt these rules from the start.

Notes that concern several projects (a change to port, a new rule, what still has to be done in another project) are written into this section – in the `CLAUDE.md` of both projects – not only into a note of a Claude project: every session reads the `CLAUDE.md` of its repository, whichever Claude project it belongs to. When a change in one project still has to be ported to another one, note it here as an open item and remove it once it is done everywhere.

### Language and wording
- Code, comments, README, CHANGELOG and commit messages in English. No German translation of the plugin (exception for now: the German settings form of `@tplnet/homebridge-heos-multiroom-audio`).
- User-facing text says "Apple Home", not "HomeKit" (README, settings schema, log messages, execution labels). Technical code comments may keep "HomeKit".

### README
- Every README has the disclaimer: a short note at the top ("Private hobby project, developed in spare time with the help of AI tools. Use at your own risk; support is best effort. See the disclaimer.") and a "Disclaimer" section before the license / credits: private project to keep compatibility, security updates, features and bug fixes going; developed in spare time with the help of AI tools; use at your own risk, no warranty (link to the project's license); questions, bug reports and requests are handled best effort, without guarantee; not affiliated with the brands named in the project.
- Keep the "Compatibility and security" (or "Security") and "Privacy" sections up to date where the README has them.

### Documentation structure
- Keep the README short: what the project is, requirements, installation, quick configuration, compatibility and security, privacy, a "Documentation" list, contributing, disclaimer, license.
- Details go into `docs/`: `configuration.md` (all options, settings for single devices, several gateways), `troubleshooting.md` (problems, debug log, reporting a problem), `releasing.md` (maintainers), images in `docs/images/`. Each page starts with a "← Back to the README" link.
- Links from the README to `docs/` are absolute GitHub URLs (`https://github.com/tplnet/<repo>/blob/master/docs/...`) so they also work on npm; inside `docs/` relative links. `docs/` is not part of the npm package.
- Screenshots of the settings form come from a real Homebridge UI with the plugin (no real credentials, example devices only), collapsible with `<details>`. Update them when the settings form changes.

### Compatibility and CVEs
- Every change and every release: `npm audit --omit=dev` must report 0 vulnerabilities in the runtime dependencies, and plugins must start with the newest Homebridge release (smoke test against `homebridge@latest`, CI on Node.js 22, 24 and 26).
- Automated in `.github/workflows/compat.yml` (weekly, on dependency changes) and in `publish.yml` (blocks the release). Keep this documented in the README.
- Dependabot pull requests can be merged when all checks are green.

### Malware scan
- Dependencies are installed with `npm ci --ignore-scripts` in every workflow (their install scripts never run). Our own packages must not need install scripts.
- `.github/workflows/malware.yml` (weekly, on dependency changes, on demand) and `publish.yml` (blocks the release) run the composite action `.github/actions/malware-scan`: OSV-Scanner (pinned version, SHA-256 checked) against `package-lock.json` – any known malicious package (OSV `MAL-…`) fails – and ClamAV over the `npm pack` tarball and `node_modules` (signatures cached between runs). The logic is in `scripts/malware-scan.mjs` (`npm run malware`, needs `osv-scanner` and `clamscan` locally).
- `.github/actions/malware-scan`, `malware.yml` and `scripts/malware-scan.mjs` are identical in all projects; new projects copy them. To update OSV-Scanner, change version and SHA-256 (from `osv-scanner_SHA256SUMS` of the release) in the action in all projects.
- README: "Malware scan" badge next to the other workflow badges and a bullet in "Compatibility and security" / "Security"; SECURITY.md describes the scan.

### Homebridge UI and log
- The window *Plugin Logs* (Homebridge UI → *Plugins* → ⋮) only shows log lines that start with the cyan prefix `[<name>]`, where `<name>` is the `name` of the plugin's config entry (without one: the package name, which Homebridge doesn't use for the plugin's lines – the window then stays empty except right after a restart). Every plugin's settings schema therefore has a `name` field with a default, and the plugin logs through the Homebridge logger. Own console output (e.g. a debug console log) uses the same prefix: `` `\x1b[36m[${config.name}]\x1b[39m` ``. Found in `@tplnet/homebridge-heos-multiroom-audio` 1.5.1-beta.8.
- Homebridge verification checks (homebridge/plugins, automatic): the settings schema must not use `"required": true/false` on single fields – required fields are listed as `"required": ["a", "b"]` at object level (JSON Schema); `package.json` keywords declare the transport: `supports-hap` for plugins that publish HAP accessories (`supports-matter` only for plugins that register Matter accessories themselves). Found in the verification request of `@tplnet/homebridge-heos-multiroom-audio` (fixed in 1.5.2-beta.1). **But not for array entries** (e.g. a device list): the Homebridge UI (5.30) starts a fresh configuration with one empty entry of each array that has a layout with `items` (`listItems: 0` doesn't help), and a `required` list makes that entry invalid → "Config Validation Failed", the form can't be saved. Use `"anyOf": [{ "required": [...] }, { "not": { "anyOf": [{ "required": ["name"] }, …] } }]` (required only once a key field is filled; no `*` in the form) and let the plugin ignore the empty entry the UI saves (only default values). Fixed in HEOS 2.1.1-beta.1, checked in a local Homebridge UI with Playwright; check this before porting the `required` list to TaHoma. Downside: the device fields have no `*` anymore – **Timo doesn't like this (2026-11-24): find a way to show the required fields again** (e.g. with the own settings page, or if a Homebridge UI version respects `listItems: 0`).

### Test environment
- Betas and configuration changes are tested in a separate test Homebridge first (container on the maintainer's Synology, UI port 8582, never paired with Apple Home), not in the live Homebridge. Commands from it still reach the real devices, so tests use harmless devices or scenes. Set up 2026-11-24, used for both plugins.

### Release process
1. Write a `## X.Y.Z (YYYY-MM-DD)` section at the top of `CHANGELOG.md` **before** `npm version`. Each entry starts with what changes for the user (Apple Home, Homebridge UI, log), technical details after it. With several entries, group them under `### Added`, `### Changed`, `### Fixed`, `### Security`.
2. `npm version patch|minor|major` (the npm `version` script runs `scripts/release-notes.mjs` and refuses to continue without the section), then `git push --follow-tags` (needs annotated tags).
3. `publish.yml` checks tag, CHANGELOG, CVEs, lint, build and Homebridge compatibility, **stages** the package with `npm stage publish` (pre-releases with the dist-tag of their identifier, e.g. `--tag beta` for `X.Y.Z-beta.N`, which the Homebridge UI uses to offer newer betas) and creates the GitHub release: title = version without "v", notes from CHANGELOG plus the "Checked for this release" block and a "Changelog" link, `--generate-notes`, pre-releases marked as such.
4. The maintainer approves the staged version with his passkey (npmjs.com → Staged Packages, or `npm stage approve <id>`).
- Never run `npm publish` manually (npm Trusted Publishing is stage-only; a manual publish burns the version number).
- `release-notes.yml` (Actions → Release notes → tag or `all`) refills existing releases from CHANGELOG.

### Git and security
- Commit as `tplnet <tplnet@users.noreply.github.com>`; never put the maintainer's real name or e-mail into commits or files.
- `master` is protected against deletion and force pushes. Security issues: private vulnerability reporting (see `SECURITY.md`).
- Never commit credentials, tokens or gateway PINs; mask them in logs and issues.
