import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isEmptyDeviceEntry } from "../../dist/config.js";

describe("empty device entry (fresh install of the settings form)", () => {
  it("an entry with only default values is empty", () => {
    assert.ok(
      isEmptyDeviceEntry({
        volumeLimitEnabled: false,
        volumeLimit: 99,
        volumeStepSize: 2,
        powerOnFavorite: 1,
        powerOnQuickSelect: 0,
        debug: false,
        inputs: [{ showInList: true }],
      }),
    );
    assert.ok(isEmptyDeviceEntry({ name: " ", serialNumber: "", ip: "" }));
    assert.ok(isEmptyDeviceEntry(undefined));
  });

  it("an entry with name, serial number or IP address is not empty (and is checked as usual)", () => {
    assert.ok(!isEmptyDeviceEntry({ name: "Kitchen" }));
    assert.ok(!isEmptyDeviceEntry({ serialNumber: "BLT012345678" }));
    assert.ok(!isEmptyDeviceEntry({ ip: "192.0.2.10" }));
  });
});
