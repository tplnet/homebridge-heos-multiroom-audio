import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DenonAudioPlatform } from "../../dist/platform.js";

describe("unknown control protocol", () => {
  it("is reported in the log and the device is skipped (no exception)", () => {
    const errors = [];
    const log = { debug() {}, info() {}, success() {}, warn() {}, error: (...args) => errors.push(args.join(" ")), log() {}, prefix: "test" };
    const api = { on() {}, hap: { Service: {}, Characteristic: {}, uuid: { generate: (s) => `uuid-${s}` } } };
    const platform = new DenonAudioPlatform(log, {}, api);
    const accessory = { displayName: "Office", UUID: "uuid-S1", context: {} };
    const handler = platform.createAccessoryHandler(accessory, { name: "Office", serialNumber: "S1", ip: "192.0.2.1", controlProtocol: "HEOS" });
    assert.equal(handler, undefined);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Could not set up device 'Office'.*Unknown control protocol 'HEOS'/);
  });
});
