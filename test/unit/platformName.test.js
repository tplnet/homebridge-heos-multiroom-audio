import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import register from "../../dist/index.js";
import {
  DenonAudioPlatform,
  LegacyDenonAudioPlatform,
} from "../../dist/platform.js";
import { LEGACY_PLATFORM_NAME, PLATFORM_NAME } from "../../dist/settings.js";

function createPlatform(PlatformClass) {
  const warnings = [];
  const unregistered = [];
  const log = {
    debug() {},
    info() {},
    success() {},
    warn: (...m) => warnings.push(m.join(" ")),
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
    platformAccessory: class {},
    publishExternalAccessories() {},
    unregisterPlatformAccessories: (_plugin, platform) =>
      unregistered.push(platform),
  };
  const platform = new PlatformClass(
    log,
    { name: "HEOS Multiroom-Audio" },
    api,
  );
  platform.runDeviceDiscovery = async () => {};
  return { platform, warnings, unregistered };
}

describe("platform name", () => {
  it("is HeosMultiroomAudio, the name of version 1.x is still registered", () => {
    assert.equal(PLATFORM_NAME, "HeosMultiroomAudio");
    assert.equal(LEGACY_PLATFORM_NAME, "DenonHeosAudio");
    const registered = new Map();
    register({
      registerPlatform: (name, constructor) =>
        registered.set(name, constructor),
    });
    assert.equal(registered.get("HeosMultiroomAudio"), DenonAudioPlatform);
    assert.equal(registered.get("DenonHeosAudio"), LegacyDenonAudioPlatform);
  });

  it("the settings forms use the new name", () => {
    for (const file of [
      "../../config.schema.json",
      "../../schemas/config.schema.de.json",
    ]) {
      const schema = JSON.parse(
        fs.readFileSync(new URL(file, import.meta.url), "utf8"),
      );
      assert.equal(schema.pluginAlias, "HeosMultiroomAudio", file);
    }
  });

  it("the new name starts without a warning", () => {
    const { warnings } = createPlatform(DenonAudioPlatform);
    assert.deepEqual(warnings, []);
  });

  it("the old name starts too, but asks to change the platform name", () => {
    const { warnings } = createPlatform(LegacyDenonAudioPlatform);
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /"platform": "DenonHeosAudio" to "platform": "HeosMultiroomAudio"/,
    );
  });

  it("cached accessories are removed under the name they were registered with", () => {
    for (const [PlatformClass, name] of [
      [DenonAudioPlatform, "HeosMultiroomAudio"],
      [LegacyDenonAudioPlatform, "DenonHeosAudio"],
    ]) {
      const { platform, unregistered } = createPlatform(PlatformClass);
      platform.configureAccessory({
        UUID: "uuid-OLD",
        displayName: "Old",
        context: {},
      });
      platform.discoverDevices();
      assert.deepEqual(unregistered, [name]);
    }
  });
});
