import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const hap = await import("@homebridge/hap-nodejs").catch(() => import("hap-nodejs"));

import { LoggerPrefixWrapper } from "../../dist/customLogging.js";
import { DenonAudioAccessory } from "../../dist/platformAccessory.js";

function recordingLog() {
  const logs = { info: [], debug: [], warn: [] };
  const log = {
    debug: (m) => logs.debug.push(m),
    info: (m) => logs.info.push(m),
    success() {},
    warn: (m) => logs.warn.push(m),
    error() {},
    log() {},
    prefix: "test",
  };
  return { log, logs };
}

function createAccessory(debug, name = "Test Speaker") {
  const { log, logs } = recordingLog();
  const platform = { api: { hap }, Service: hap.Service, Characteristic: hap.Characteristic };
  const accessory = new hap.Accessory(name, hap.uuid.generate(`debug-log-test-${name}-${debug}`));
  const handler = new DenonAudioAccessory(
    platform,
    accessory,
    { name, serialNumber: "BLT012345678", ip: "192.0.2.10", controlProtocol: "HEOSCLI", debug },
    log,
  );
  return { handler, logs };
}

describe("debug log per device", () => {
  it("writes debug messages as info messages with the device name", () => {
    const { log, logs } = recordingLog();
    new LoggerPrefixWrapper(log, "Kitchen", true).debug("Sending command:", "heos://system/heart_beat");
    assert.equal(logs.debug.length, 0);
    assert.deepEqual(logs.info, ["[Kitchen] [debug] Sending command:"]);
  });

  it("keeps debug messages at debug level without the option", () => {
    const { log, logs } = recordingLog();
    new LoggerPrefixWrapper(log, "Kitchen").debug("hello");
    assert.deepEqual(logs.debug, ["[Kitchen] hello"]);
    assert.equal(logs.info.length, 0);
  });

  it("routes the commands and answers of the device client to the normal log", () => {
    const { handler, logs } = createAccessory(true);
    assert.ok(logs.info.some((m) => m.includes("Debug log is on for this device")));
    handler.denonClient.debugLog("Sending command:", "heos://player/get_players");
    assert.ok(logs.info.some((m) => m === "[Test Speaker] [debug] Sending command:"), JSON.stringify(logs.info));
  });

  it("doesn't change the log of other devices", () => {
    const { handler, logs } = createAccessory(false, "Other Speaker");
    assert.ok(!logs.info.some((m) => m.includes("Debug log is on")));
    handler.denonClient.debugLog("Sending command:");
    assert.ok(!logs.info.some((m) => m.includes("Sending command")));
    assert.ok(logs.debug.some((m) => m.includes("Sending command")));
  });

  it("logs favorites and Quick Select slots at startup", async () => {
    const { handler, logs } = createAccessory(true, "Startup Speaker");
    handler.denonClient = {
      setPowerOnFavorite() {},
      getFavorites: async () => ["Radio One", "Jazz"],
      getQuickSelects: async () => ["Radio", "TV"],
    };
    await handler.checkPowerOnSource();
    assert.ok(logs.info.some((m) => m.includes("HEOS favorites reported by the device: 1: Radio One, 2: Jazz")));
    assert.ok(logs.info.some((m) => m.includes("Quick Select slots reported by the device: 1: Radio, 2: TV")));
  });

  it("is an option of the device entry in all languages, off by default", () => {
    for (const file of ["../../config.schema.json", "../../schemas/config.schema.de.json"]) {
      const schema = JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
      const debug = schema.schema.properties.devices.items.properties.debug;
      assert.equal(debug.type, "boolean", file);
      assert.equal(debug.default, false, file);
      assert.ok(JSON.stringify(schema.layout).includes('"devices[].debug"'), file);
    }
  });
});
