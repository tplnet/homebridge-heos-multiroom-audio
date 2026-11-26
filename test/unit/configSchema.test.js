import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const schema = JSON.parse(
  fs.readFileSync(new URL("../../config.schema.json", import.meta.url), "utf8"),
);

function collectArrays(node, path, result = []) {
  if (node && typeof node === "object") {
    if (node.type === "array") {
      result.push({ path, node });
    }
    for (const [key, value] of Object.entries(node.properties ?? {})) {
      collectArrays(value, `${path}.${key}`, result);
    }
    if (node.items) {
      collectArrays(node.items, `${path}[]`, result);
    }
  }
  return result;
}

describe("config.schema.json", () => {
  it("disables drag & drop ordering for all lists (the Homebridge UI drag handle gets stuck after using a dropdown)", () => {
    const arrays = collectArrays(schema.schema, "schema");
    assert.ok(arrays.length >= 3);
    for (const { path, node } of arrays) {
      assert.equal(
        node.orderable,
        false,
        `${path} must set "orderable": false`,
      );
    }
  });

  it("lists every option of the platform", () => {
    assert.deepEqual(Object.keys(schema.schema.properties).sort(), [
      "autoAddDiscoveredDevices",
      "consoleLogEnabled",
      "consoleLogLevel",
      "deviceDiscovery",
      "devices",
      "excludedSerialNumbers",
      "name",
    ]);
  });
});

const TEXT_KEYS = new Set(["title", "description", "placeholder"]);
const withoutTexts = (node) =>
  Array.isArray(node)
    ? node.map(withoutTexts)
    : node && typeof node === "object"
      ? Object.fromEntries(
          Object.entries(node)
            .filter(([key]) => !TEXT_KEYS.has(key))
            .map(([key, value]) => [key, withoutTexts(value)]),
        )
      : node;
const texts = (node, result = []) => {
  if (Array.isArray(node)) {
    node.forEach((value) => texts(value, result));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (TEXT_KEYS.has(key) && typeof value === "string") {
        result.push(key);
      } else {
        texts(value, result);
      }
    }
  }
  return result;
};

describe("translated config schemas (Homebridge UI)", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  const languages = ["de"];

  it("are found by the Homebridge UI and published", () => {
    assert.equal(packageJson.directories?.schemas, "schemas");
    assert.ok(packageJson.files.includes("schemas/*.json"));
  });

  for (const language of languages) {
    const translated = JSON.parse(
      fs.readFileSync(
        new URL(
          `../../schemas/config.schema.${language}.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );

    it(`${language}: same fields, defaults and limits as config.schema.json`, () => {
      assert.deepEqual(withoutTexts(translated), withoutTexts(schema));
    });

    it(`${language}: has the same texts as config.schema.json`, () => {
      assert.deepEqual(texts(translated), texts(schema));
    });
  }
});

describe("device discovery options", () => {
  it("discovery is off by default, auto-add and excluded devices are only shown with discovery", () => {
    assert.equal(schema.schema.properties.deviceDiscovery.default, false);
    assert.equal(schema.schema.properties.autoAddDiscoveredDevices.default, false);
    const layoutItem = (key) => schema.layout.find((item) => item.key === key);
    const shown = (key, model) => new Function("model", layoutItem(key).condition.functionBody)(model);
    assert.equal(shown("autoAddDiscoveredDevices", { deviceDiscovery: false }), false);
    assert.equal(shown("autoAddDiscoveredDevices", {}), false);
    assert.equal(shown("autoAddDiscoveredDevices", { deviceDiscovery: true }), true);
    assert.equal(shown("excludedSerialNumbers", { deviceDiscovery: true }), false);
    assert.equal(shown("excludedSerialNumbers", { deviceDiscovery: false, autoAddDiscoveredDevices: true }), false);
    assert.equal(shown("excludedSerialNumbers", { deviceDiscovery: true, autoAddDiscoveredDevices: true }), true);
  });
});

describe("settings form layout", () => {
  // with a layout, the Homebridge UI only shows the fields listed in it
  const schemaKeys = (node, prefix, result = []) => {
    for (const [key, value] of Object.entries(node.properties ?? {})) {
      const path = prefix ? `${prefix}.${key}` : key;
      result.push(path);
      if (value.type === "array" && value.items?.properties) {
        schemaKeys(value.items, `${path}[]`, result);
      }
    }
    return result;
  };
  const layoutKeys = (items, result = []) => {
    for (const item of items) {
      if (typeof item === "string") {
        result.push(item);
      } else {
        if (item.key) {
          result.push(item.key);
        }
        if (Array.isArray(item.items)) {
          layoutKeys(item.items, result);
        }
      }
    }
    return result;
  };
  it("shows every option exactly once", () => {
    const expected = schemaKeys(schema.schema, "").sort();
    // "excludedSerialNumbers[]" only selects the entries of the list
    const shown = layoutKeys(schema.layout).filter(
      (key) => !key.endsWith("[]"),
    );
    assert.deepEqual([...shown].sort(), expected);
  });

  it("disables drag & drop ordering for the lists in the layout", () => {
    const arrays = [];
    const walk = (items) =>
      items.forEach((item) => {
        if (item && typeof item === "object") {
          if (item.type === "array") arrays.push(item);
          if (Array.isArray(item.items)) walk(item.items);
        }
      });
    walk(schema.layout);
    assert.equal(arrays.length, 3);
    arrays.forEach((array) =>
      assert.equal(
        array.orderable,
        false,
        `${array.key} must set "orderable": false`,
      ),
    );
  });
});

// checks of the Homebridge plugin verification (homebridge/plugins)
describe("Homebridge verification checks", () => {
  const schemas = [
    "../../config.schema.json",
    "../../schemas/config.schema.de.json",
  ].map((file) => [
    file,
    JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8")),
  ]);

  it("uses `required` only as a list at object level (no `required: true/false` on single fields)", () => {
    const booleans = [];
    const walk = (node, path) => {
      if (node && typeof node === "object") {
        if (typeof node.required === "boolean") {
          booleans.push(path);
        }
        if (node.required !== undefined && typeof node.required !== "boolean") {
          assert.ok(
            Array.isArray(node.required),
            `${path}.required must be an array`,
          );
        }
        for (const [key, value] of Object.entries(node.properties ?? {})) {
          walk(value, `${path}.${key}`);
        }
        if (node.items) {
          walk(node.items, `${path}[]`);
        }
      }
    };
    for (const [file, json] of schemas) {
      walk(json.schema, file);
    }
    assert.deepEqual(booleans, []);
  });

  it("a device entry requires name, serial number, IP address and protocol, unless it is empty", () => {
    // A plain `required` list makes the empty entry the Homebridge UI shows on a fresh install invalid
    // ("Config Validation Failed", the form can't be saved). anyOf: complete, or none of name / serial / IP.
    for (const [file, json] of schemas) {
      const items = json.schema.properties.devices.items;
      assert.equal(items.required, undefined, file);
      assert.deepEqual(items.anyOf[0].required, ["name", "serialNumber", "ip", "controlProtocol"], file);
      const empty = items.anyOf[1].not.anyOf.map((s) => s.required[0]);
      assert.deepEqual(empty, ["name", "serialNumber", "ip"], file);
    }
  });

  it("package.json declares the supported transport (HAP)", () => {
    const pkg = JSON.parse(
      fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );
    assert.ok(pkg.keywords.includes("homebridge-plugin"));
    assert.ok(pkg.keywords.includes("supports-hap"));
    assert.ok(
      !pkg.keywords.includes("supports-matter"),
      "the plugin doesn't register Matter accessories itself",
    );
  });
});
