import { describe, it } from "node:test";
import assert from "node:assert/strict";
const hap = await import("@homebridge/hap-nodejs").catch(
  () => import("hap-nodejs"),
);

import { DenonAudioAccessory } from "../../dist/platformAccessory.js";
import {
  ConnectionTimeoutException,
  DefaultInput,
} from "../../dist/denonClient.js";
import { DenonClientHeosCli } from "../../dist/denonClientHeosCli.js";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function createAccessory() {
  const logs = { warn: [], info: [], error: [], debug: [] };
  const log = {
    debug: (m) => logs.debug.push(m),
    info: (m) => logs.info.push(m),
    success() {},
    warn: (m) => logs.warn.push(m),
    error: (m) => logs.error.push(m),
    log() {},
    prefix: "test",
  };
  const platform = {
    api: { hap },
    Service: hap.Service,
    Characteristic: hap.Characteristic,
  };
  const accessory = new hap.Accessory(
    "Office Speaker",
    hap.uuid.generate(`unreachable-${Math.random()}`),
  );
  const handler = new DenonAudioAccessory(
    platform,
    accessory,
    {
      name: "Office Speaker",
      serialNumber: "S",
      ip: "192.0.2.10",
      controlProtocol: "HEOSCLI",
    },
    log,
  );
  const state = { reachable: false };
  const offline = () =>
    new ConnectionTimeoutException({ host: "192.0.2.10", port: 1255, connect_timeout: 5000 });
  handler.denonClient = {
    defaultInputs: DenonClientHeosCli.DEFAULT_INPUT_SOURCES,
    displayOnlyInputs: DenonClientHeosCli.DISPLAY_ONLY_INPUT_SOURCES,
    getInputSources: async () => {
      if (!state.reachable) throw offline();
      return [new DefaultInput("aux_in_1", "AUX In")];
    },
    getPower: async () => {
      if (!state.reachable) throw offline();
      return true;
    },
  };
  return { handler, logs, state, accessory };
}

describe("device not reachable (e.g. switched off at the mains)", () => {
  it("logs one warning instead of an error at every query, and an info when it is back", async () => {
    const { handler, logs, state } = createAccessory();
    await handler.setupInputs();
    for (let i = 0; i < 3; i++) {
      await assert.rejects(handler.getActive());
    }
    assert.equal(logs.error.length, 0);
    assert.equal(logs.warn.length, 1);
    assert.match(
      logs.warn[0],
      /The device is not reachable \(connection to 192\.0\.2\.10:1255 timed out after 5000ms\.\)/,
    );

    state.reachable = true;
    assert.equal(await handler.getActive(), true);
    assert.ok(logs.info.some((m) => m.endsWith("The device is reachable again.")));

    // offline again: warned again (once)
    state.reachable = false;
    await assert.rejects(handler.getActive());
    await assert.rejects(handler.getActive());
    assert.equal(logs.warn.length, 2);
  });

  it("reads and shows the inputs once the device answers, if they couldn't be read at startup", async () => {
    const { handler, logs, state, accessory } = createAccessory();
    await handler.setupInputs();
    assert.ok(
      logs.info.some((m) => m.includes("Using the default input list")),
    );
    const service = accessory.getService("Office Speaker Input aux_in_1");
    const visibility = () =>
      service.getCharacteristic(hap.Characteristic.CurrentVisibilityState)
        .value;
    assert.equal(
      visibility(),
      hap.Characteristic.CurrentVisibilityState.HIDDEN,
    );

    state.reachable = true;
    await handler.getActive();
    await tick(10);
    assert.equal(visibility(), hap.Characteristic.CurrentVisibilityState.SHOWN);
    assert.equal(
      service.getCharacteristic(hap.Characteristic.ConfiguredName).value,
      "AUX In",
    );
    assert.ok(
      logs.info.some((m) =>
        m.includes("read after the device became reachable"),
      ),
    );
  });
});

describe("now playing without a source", () => {
  it("an empty payload (speaker just started) means no input, not an error", () => {
    assert.equal(DenonClientHeosCli.inputPayloadToInputID("{}"), "");
  });
});
