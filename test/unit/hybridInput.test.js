import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DenonClientHybrid } from "../../dist/denonClientHybrid.js";

// HEOS input ids of a Marantz Cinema 60 (browse/browse?sid=<pid>)
const CINEMA_60_INPUTS = ["bluray", "game", "aux1", "aux2"];

/** Hybrid client without network connections, only the input mapping. */
function hybridWithoutConnections(knownInputIds, heosInput = "spotify") {
  const reported = [];
  const hybrid = Object.create(DenonClientHybrid.prototype);
  Object.assign(hybrid, {
    knownInputIds,
    debugLog: () => {},
    inputUpdateCallback: (input) => reported.push(input),
    clientHeosCli: { getInput: async () => heosInput },
  });
  return { hybrid, reported };
}

describe("Hybrid: input changed on the receiver (AVR Control SI…)", () => {
  it("maps AVR Control input codes to the HEOS input ids of the device", () => {
    assert.equal(
      DenonClientHybrid.heosInputFromAvrInput("AUX1", CINEMA_60_INPUTS),
      "aux1",
    );
    assert.equal(
      DenonClientHybrid.heosInputFromAvrInput("BD", CINEMA_60_INPUTS),
      "bluray",
    );
    assert.equal(
      DenonClientHybrid.heosInputFromAvrInput("GAME1", CINEMA_60_INPUTS),
      "game",
    );
    assert.equal(
      DenonClientHybrid.heosInputFromAvrInput("GAME", CINEMA_60_INPUTS),
      "game",
    );
  });

  it("prefers the candidate the device offers", () => {
    assert.equal(
      DenonClientHybrid.heosInputFromAvrInput("TV", ["tv", "optical_in_1"]),
      "tv",
    );
    assert.equal(
      DenonClientHybrid.heosInputFromAvrInput("TV", ["tvaudio", "cd"]),
      "tvaudio",
    );
    assert.equal(
      DenonClientHybrid.heosInputFromAvrInput("CBL/SAT", ["cable_sat"]),
      "cable_sat",
    );
    assert.equal(
      DenonClientHybrid.heosInputFromAvrInput("MPLAY", ["mediaplayer"]),
      "mediaplayer",
    );
  });

  it("uses the first candidate while the input list is unknown", () => {
    assert.equal(DenonClientHybrid.heosInputFromAvrInput("TV", []), "tvaudio");
    assert.equal(DenonClientHybrid.heosInputFromAvrInput("AUX2", []), "aux2");
  });

  it("leaves HEOS music sources and inputs HEOS doesn't offer to HEOS", () => {
    assert.equal(
      DenonClientHybrid.heosInputFromAvrInput("NET", CINEMA_60_INPUTS),
      undefined,
    );
    assert.equal(DenonClientHybrid.heosInputFromAvrInput("BT", []), undefined);
    assert.equal(
      DenonClientHybrid.heosInputFromAvrInput("PHONO", CINEMA_60_INPUTS),
      undefined,
    );
  });

  it("reports a mapped input directly", () => {
    const { hybrid, reported } = hybridWithoutConnections(CINEMA_60_INPUTS);
    hybrid.onAvrInputChanged("GAME1");
    hybrid.onAvrInputChanged("AUX1");
    assert.deepEqual(reported, ["game", "aux1"]);
  });

  it("asks HEOS for the current source of a HEOS music source", async () => {
    const { hybrid, reported } = hybridWithoutConnections(
      CINEMA_60_INPUTS,
      "spotify",
    );
    hybrid.onAvrInputChanged("NET");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(reported, ["spotify"]);
  });

  it("ignores a failed HEOS query", async () => {
    const { hybrid, reported } = hybridWithoutConnections(CINEMA_60_INPUTS);
    hybrid.clientHeosCli = {
      getInput: async () => Promise.reject(new Error("timeout")),
    };
    hybrid.onAvrInputChanged("NET");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(reported, []);
  });
});

describe("Hybrid: switching on resumes the music like HEOS CLI", () => {
  function hybrid({ input = "spotify", resumeFails = false, knownInputIds = ["tv", "optical_in_1", "line_in_1"] } = {}) {
    const calls = [];
    const h = Object.create(DenonClientHybrid.prototype);
    Object.assign(h, {
      knownInputIds,
      resumeDelayMs: 0,
      debugLog: () => {},
      clientAvrControl: { setPower: async (power) => (calls.push(power ? "PWON" : "PWSTANDBY"), power) },
      clientHeosCli: {
        getInput: async () => input,
        resumePlayback: async () => {
          calls.push("resume");
          if (resumeFails) throw new Error("timeout");
          return true;
        },
      },
    });
    return { h, calls };
  }

  it("switches on and continues the music (or starts the favorite) if a HEOS music source was last", async () => {
    for (const input of ["spotify", "airplay", "tunein", "1024"]) {
      const { h, calls } = hybrid({ input });
      assert.equal(await h.setPower(true), true);
      assert.deepEqual(calls, ["PWON", "resume"], input);
    }
  });

  it("only switches on if an input was the last source (TV, HDMI, optical …)", async () => {
    for (const input of ["tv", "optical_in_1", "aux1", "hdmi_in_1", "cd"]) {
      const { h, calls } = hybrid({ input });
      assert.equal(await h.setPower(true), true);
      assert.deepEqual(calls, ["PWON"], input);
    }
  });

  it("stays switched on if resuming fails", async () => {
    const { h, calls } = hybrid({ resumeFails: true });
    assert.equal(await h.setPower(true), true);
    assert.deepEqual(calls, ["PWON", "resume"]);
  });

  it("switching off only sends standby", async () => {
    const { h, calls } = hybrid();
    assert.equal(await h.setPower(false), false);
    assert.deepEqual(calls, ["PWSTANDBY"]);
  });

  it("passes favorite and Quick Select on to HEOS", () => {
    const set = [];
    const h = Object.create(DenonClientHybrid.prototype);
    h.clientHeosCli = { setPowerOnFavorite: (p) => set.push(`favorite ${p}`), setPowerOnQuickSelect: (q) => set.push(`quick select ${q}`) };
    h.setPowerOnFavorite(2);
    h.setPowerOnQuickSelect(3);
    assert.deepEqual(set, ["favorite 2", "quick select 3"]);
  });
});
