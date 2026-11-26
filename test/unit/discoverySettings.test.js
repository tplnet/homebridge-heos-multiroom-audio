import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DenonAudioPlatform } from "../../dist/platform.js";

function createPlatform(config) {
  const warnings = [];
  const log = { debug() {}, info() {}, success() {}, warn: (...args) => warnings.push(args.join(" ")), error() {}, log() {}, prefix: "test" };
  const api = {
    on() {},
    hap: { Service: {}, Characteristic: {}, uuid: { generate: (s) => `uuid-${s}` } },
    platformAccessory: class {
      constructor(displayName, UUID) {
        this.displayName = displayName;
        this.UUID = UUID;
        this.context = {};
      }
    },
  };
  const platform = new DenonAudioPlatform(log, config, api);
  const published = [];
  let discoveryRuns = 0;
  platform.publishNewAccessory = (deviceConfig) => published.push(deviceConfig);
  platform.runDeviceDiscovery = async () => {
    discoveryRuns++;
  };
  platform.discoverDevices();
  platform.closeInitialWindow();
  clearTimeout(platform.initialWindowTimer);
  clearTimeout(platform.overviewTimer);
  return { platform, published, warnings, discoveryRuns: () => discoveryRuns };
}

const manual = { name: "Dining Room", serialNumber: "BMC012345678", ip: "192.0.2.10", controlProtocol: "HEOSCLI" };

describe("device discovery settings", () => {
  it("no discovery without the option (default off)", () => {
    const { discoveryRuns, warnings } = createPlatform({});
    assert.equal(discoveryRuns(), 0);
    assert.deepEqual(warnings, []);
  });

  it("manual devices are set up without discovery", () => {
    const { discoveryRuns, published } = createPlatform({ deviceDiscovery: false, devices: [manual] });
    assert.equal(discoveryRuns(), 0);
    assert.deepEqual(published, [manual]);
  });

  it("runs the discovery when it is switched on", () => {
    const { discoveryRuns } = createPlatform({ deviceDiscovery: true });
    assert.equal(discoveryRuns(), 1);
  });

  it("auto-add without the discovery option (hand-written configuration) still discovers, as before", () => {
    const { platform, discoveryRuns, warnings } = createPlatform({ autoAddDiscoveredDevices: true });
    assert.equal(discoveryRuns(), 1);
    assert.equal(platform.autoAddEnabled(), true);
    assert.deepEqual(warnings, []);
  });

  it("discovery switched off also switches off auto-add, with a warning", () => {
    const { platform, discoveryRuns, warnings } = createPlatform({ deviceDiscovery: false, autoAddDiscoveredDevices: true });
    assert.equal(discoveryRuns(), 0);
    assert.equal(platform.autoAddEnabled(), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Device Discovery' is off/);
  });
});
