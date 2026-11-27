import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildRows, addManualEntry, setExcluded, autoAddEnabled, TEXTS, texts, format } from "../../homebridge-ui/public/overview.js";

const found = (serialNumber, name, controlProtocol = "HEOSCLI") => ({ serialNumber, name, controlProtocol, ip: "192.0.2.1", modelName: "Denon Home 150" });
const manual = (serialNumber, name) => ({ serialNumber, name, ip: "192.0.2.9", controlProtocol: "HYBRID" });
const status = (rows) => Object.fromEntries(rows.map((row) => [row.serialNumber, row.status]));

describe("settings page: device overview", () => {
  it("shows manual, automatic, excluded and unreachable devices like the plugin treats them", () => {
    const config = {
      deviceDiscovery: true,
      autoAddDiscoveredDevices: true,
      excludedSerialNumbers: [" blt000000003"],
      devices: [manual("S1", "Manual"), manual("S9", "Missing"), { volumeLimit: 99 }],
    };
    const rows = buildRows(config, [found("S1", "Found Manual"), found("S2", "Auto"), found("BLT000000003", "Excluded"), found("S4", "Off", null)], true);
    assert.deepEqual(status(rows), { S1: "manual", S9: "manualNotFound", S2: "auto", BLT000000003: "excluded", S4: "unreachable" });
    // a manual entry shows its own settings, the model comes from the search
    const s1 = rows.find((row) => row.serialNumber === "S1");
    assert.equal(s1.name, "Manual");
    assert.equal(s1.controlProtocol, "HYBRID");
    assert.equal(s1.modelName, "Denon Home 150");
    assert.deepEqual(rows.find((row) => row.serialNumber === "S2").actions, ["edit", "exclude"]);
  });

  it("doesn't claim 'not found' while the search is running", () => {
    assert.equal(buildRows({ devices: [manual("S9", "Missing")] }, [], false)[0].status, "manual");
  });

  it("without auto-add the found devices can be set up manually", () => {
    for (const config of [{}, { deviceDiscovery: false, autoAddDiscoveredDevices: true }, { deviceDiscovery: true }]) {
      const [row] = buildRows(config, [found("S2", "Speaker")], true);
      assert.equal(row.status, "notAdded");
      assert.deepEqual(row.actions, ["setup"]);
    }
  });

  it("uses the same auto-add rule as the plugin", () => {
    assert.equal(autoAddEnabled({ autoAddDiscoveredDevices: true }), true);
    assert.equal(autoAddEnabled({ deviceDiscovery: false, autoAddDiscoveredDevices: true }), false);
    assert.equal(autoAddEnabled({ deviceDiscovery: true }), false);
  });
});

describe("settings page: changing the configuration", () => {
  it("edit adds a manual entry with the values of the found device and replaces the empty form entry", () => {
    const config = { autoAddDiscoveredDevices: true, devices: [{ volumeLimit: 99, inputs: [{ showInList: true }] }] };
    const result = addManualEntry(config, found("S2", "Speaker", "HYBRID"));
    assert.deepEqual(result.devices, [{ name: "Speaker", serialNumber: "S2", ip: "192.0.2.1", controlProtocol: "HYBRID" }]);
    assert.equal(config.devices.length, 1, "the original config is not changed");
    assert.equal(addManualEntry(result, found("s2 ", "Again")), result, "no second entry for the same device");
  });

  it("exclude and include maintain the excluded devices", () => {
    const excluded = setExcluded({ excludedSerialNumbers: ["S1"] }, "S2", true);
    assert.deepEqual(excluded.excludedSerialNumbers, ["S1", "S2"]);
    assert.deepEqual(setExcluded(excluded, " s1", false).excludedSerialNumbers, ["S2"]);
  });
});

describe("settings page: texts", () => {
  it("English and German have the same texts", () => {
    assert.deepEqual(Object.keys(TEXTS.de).sort(), Object.keys(TEXTS.en).sort());
  });

  it("has a text for every status and action", () => {
    const html = fs.readFileSync(new URL("../../homebridge-ui/public/index.html", import.meta.url), "utf8");
    for (const key of html.matchAll(/data-text="(\w+)"/g)) {
      assert.ok(TEXTS.en[key[1]], key[1]);
    }
    for (const key of ["manual", "manualNotFound", "auto", "excluded", "notAdded", "unreachable"]) {
      assert.ok(TEXTS.en[`status_${key}`], key);
    }
    for (const key of ["edit", "setup", "exclude", "include"]) {
      assert.ok(TEXTS.en[`action_${key}`], key);
    }
  });

  it("falls back to English", () => {
    assert.equal(texts("de-DE"), TEXTS.de);
    assert.equal(texts("fr"), TEXTS.en);
    assert.equal(format("'{name}' ok", { name: "A" }), "'A' ok");
  });
});

describe("settings page: package", () => {
  const schema = JSON.parse(fs.readFileSync(new URL("../../config.schema.json", import.meta.url), "utf8"));
  const packageJson = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

  it("is enabled in the schema and published", () => {
    assert.equal(schema.customUi, true);
    assert.equal(schema.singular, true, "the schema form below the overview needs a singular platform");
    assert.ok(packageJson.files.includes("homebridge-ui/**/*"));
    assert.ok(packageJson.dependencies["@homebridge/plugin-ui-utils"]);
  });
});
