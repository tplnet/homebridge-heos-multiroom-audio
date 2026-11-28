import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CommandFailedException, CommandMode } from "../../dist/denonClient.js";
import { DenonClientHeosCli } from "../../dist/denonClientHeosCli.js";
import { DenonAudioAccessory } from "../../dist/platformAccessory.js";

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("command refused by the device: reason", () => {
  it("reads error id and text of a HEOS failure message", () => {
    assert.deepEqual(DenonClientHeosCli.parseError("eid=13&text=Processing previous command&pid=1"), { errorId: 13, errorText: "Processing previous command" });
    assert.deepEqual(DenonClientHeosCli.parseError("eid=2&text=ID%20Not%20Valid"), { errorId: 2, errorText: "ID Not Valid" });
    assert.deepEqual(DenonClientHeosCli.parseError(undefined), { errorId: undefined, errorText: undefined });
  });

  it("puts the reason into the exception", () => {
    const error = new CommandFailedException("player/get_volume", 13, "Processing previous command");
    assert.match(error.message, /player\/get_volume.*\(eid=13: Processing previous command\)\.$/);
    assert.equal(error.reason, "eid=13: Processing previous command");
    assert.equal(new CommandFailedException("x").reason, "no reason given by the device");
    assert.match(new CommandFailedException("x").message, /side\.$/);
  });

  it("a 'fail' response carries the reason", async () => {
    const client = new DenonClientHeosCli("SERIAL", "Test", "127.0.0.1", 200, 200, () => {});
    client.player_id = 5;
    client.socket = { write() {} };
    const pending = client.sendUnchecked("player/get_mute?pid=5", "player/get_mute", /state=(\w+)/);
    client.dataHandler(Buffer.from(JSON.stringify({ heos: { command: "player/get_mute", result: "fail", message: "eid=13&text=Processing previous command" } }) + "\r\n"));
    await assert.rejects(pending, (error) => error instanceof CommandFailedException && error.errorId === 13 && error.errorText === "Processing previous command");
    client.socket = undefined;
  });
});

describe("command refused by the device: invalid player id", () => {
  async function createClient(failWith, newId = 222) {
    const client = new DenonClientHeosCli("SERIAL", "Test", "127.0.0.1", 200, 200, () => {});
    await client.playerIdLookup?.catch(() => {}); // the lookup started by the constructor (nothing listens there)
    client.player_id = 111;
    const sent = [];
    // replaces the socket part: the old id is refused, the player list has a new id
    client.send = async (command, rawCommand) => {
      sent.push(command);
      if (rawCommand === "player/get_players") {
        return JSON.stringify([{ serial: "OTHER", pid: 1 }, { serial: "SERIAL", pid: newId, name: "Test" }]);
      }
      if (command.includes("pid=111")) {
        throw new CommandFailedException(rawCommand, failWith, "x");
      }
      return "on";
    };
    return { client, sent };
  }

  it("looks up the player id again and repeats the command once", async () => {
    const { client, sent } = await createClient(2);
    assert.equal(await client.sendCommand(DenonClientHeosCli.PROTOCOL.MUTE, CommandMode.GET, {}), "on");
    assert.equal(client.player_id, 222);
    assert.deepEqual(sent, ["player/get_mute?pid=111", "player/get_players", "player/get_mute?pid=222"]);
  });

  it("other refusals are not repeated", async () => {
    const { client, sent } = await createClient(13);
    await assert.rejects(client.sendCommand(DenonClientHeosCli.PROTOCOL.MUTE, CommandMode.GET, {}), CommandFailedException);
    assert.deepEqual(sent, ["player/get_mute?pid=111"]);
    assert.equal(client.player_id, 111);
  });

  it("'Invalid ID' with an unchanged player id is not repeated", async () => {
    const { client, sent } = await createClient(2, 111);
    await assert.rejects(client.sendCommand(DenonClientHeosCli.PROTOCOL.MUTE, CommandMode.GET, {}), (error) => error instanceof CommandFailedException && error.errorId === 2);
    assert.deepEqual(sent, ["player/get_mute?pid=111", "player/get_players"]);
  });
});

describe("command refused by the device: log", () => {
  const createAccessory = () => {
    const lines = { warn: [], error: [], debug: [] };
    const fake = {
      refusalWindowOpen: false,
      refusalsInWindow: 0,
      log: { warn: (line) => lines.warn.push(line), error: (line) => lines.error.push(line), debug: (line) => lines.debug.push(line) },
    };
    const logCommandError = (action, error) => DenonAudioAccessory.prototype.logCommandError.call(fake, action, error);
    return { lines, logCommandError };
  };

  it("one warning with the reason, the following refusals summarized in one line", async () => {
    const previous = DenonAudioAccessory.REFUSAL_SUMMARY_WINDOW;
    DenonAudioAccessory.REFUSAL_SUMMARY_WINDOW = 30;
    try {
      const { lines, logCommandError } = createAccessory();
      const refused = new CommandFailedException("player/get_play_state", 13, "Processing previous command");
      for (const action of ["getting power status", "getting current input", "getting mute status", "getting volume"]) {
        logCommandError(action, refused);
      }
      assert.deepEqual(lines.warn, ["The device refused getting power status (eid=13: Processing previous command)."]);
      assert.equal(lines.debug.length, 3);
      await tick(60);
      assert.deepEqual(lines.warn.slice(1), ["The device refused 3 more commands right after that (details in the debug log)."]);
      assert.deepEqual(lines.error, []);

      // later refusals get their own warning again, without a summary if there are no more
      logCommandError("getting volume", refused);
      await tick(60);
      assert.equal(lines.warn.length, 3);
    } finally {
      DenonAudioAccessory.REFUSAL_SUMMARY_WINDOW = previous;
    }
  });

  it("other errors are still logged as errors", () => {
    const { lines, logCommandError } = createAccessory();
    logCommandError("setting volume", new Error("boom"));
    assert.deepEqual(lines.error, ["An error occurred while setting volume."]);
    assert.deepEqual(lines.warn, []);
  });
});
