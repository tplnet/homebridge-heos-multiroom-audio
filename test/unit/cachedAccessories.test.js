import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DenonAudioPlatform } from "../../dist/platform.js";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function createPlatform(config) {
  const published = [];
  const unregistered = [];
  const infos = [];
  const log = {
    debug() {},
    info: (...m) => infos.push(m.join(" ")),
    success() {},
    warn() {},
    error() {},
    log() {},
    prefix: "test",
  };
  const api = {
    on() {},
    hap: {
      Service: {},
      Characteristic: {},
      uuid: { generate: (s) => `uuid-${s}` },
    },
    platformAccessory: class {
      constructor(displayName, UUID) {
        this.displayName = displayName;
        this.UUID = UUID;
        this.context = {};
      }
    },
    publishExternalAccessories: (_plugin, accessories) =>
      published.push(...accessories.map((a) => a.UUID)),
    unregisterPlatformAccessories: (_plugin, _platform, accessories) =>
      unregistered.push(...accessories.map((a) => a.UUID)),
  };
  const platform = new DenonAudioPlatform(log, config, api);
  platform.withCheckedProtocol = async (deviceConfig) => deviceConfig;
  platform.createAccessoryHandler = () => ({ setupInputs: async () => {} });
  platform.runDeviceDiscovery = async () => {};
  return { platform, published, unregistered, infos };
}

const device = {
  serialNumber: "BLT012345678",
  name: "Office Speaker",
  ip: "192.0.2.10",
  controlProtocol: "HEOSCLI",
};

describe("accessories from the Homebridge cache (older versions published them on the bridge)", () => {
  it("are removed from the cache, and the device is published again as external accessory", async () => {
    const { platform, published, unregistered, infos } = createPlatform({
      devices: [device],
    });
    platform.configureAccessory({
      UUID: "uuid-BLT012345678",
      displayName: "Office Speaker",
      context: {},
    });
    platform.configureAccessory({
      UUID: "uuid-OLD",
      displayName: "Removed Speaker",
      context: {},
    });
    platform.discoverDevices();
    await tick(20);
    assert.deepEqual(unregistered.sort(), ["uuid-BLT012345678", "uuid-OLD"]);
    assert.deepEqual(
      published,
      ["uuid-BLT012345678"],
      "same UUID, so the Home app pairing stays",
    );
    assert.ok(
      infos.some((line) =>
        line.includes("Removed 2 accessories of an older plugin version"),
      ),
    );
  });

  it("nothing is removed without cached accessories", async () => {
    const { platform, published, unregistered } = createPlatform({
      devices: [device],
    });
    platform.discoverDevices();
    await tick(20);
    assert.deepEqual(unregistered, []);
    assert.deepEqual(published, ["uuid-BLT012345678"]);
  });
});
