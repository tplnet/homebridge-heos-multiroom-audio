import {
  DefaultInput,
  IDenonClient,
  Playing,
  RaceStatus,
} from "./denonClient.js";
import { DenonClientAvrControl } from "./denonClientAvrControl.js";
import { DenonClientHeosCli } from "./denonClientHeosCli.js";
import { ControlMode } from "./controlMode.js";

export class DenonClientHybrid implements IDenonClient {
  public readonly controlMode = ControlMode.HYBRID;
  public readonly serialNumber: string;
  public readonly name: string;
  public readonly defaultInputs = DenonClientHeosCli.DEFAULT_INPUT_SOURCES;
  public readonly displayOnlyInputs =
    DenonClientHeosCli.DISPLAY_ONLY_INPUT_SOURCES;

  private readonly clientAvrControl;
  private readonly clientHeosCli;
  private readonly debugLog: (message: string, ...parameters: any[]) => void;
  private readonly inputUpdateCallback?: (input: string) => void;
  /** HEOS input ids of the device (from getInputSources), used to map AVR Control input codes. */
  private knownInputIds: string[] = [];

  /**
   * AVR Control input codes (SI…) whose HEOS input id differs from the lower-case code.
   * Several candidates: the first one the device offers is used.
   */
  private static readonly AVR_TO_HEOS_INPUTS: Record<string, string[]> = {
    BD: ["bluray"],
    "CBL/SAT": ["cable_sat"],
    "SAT/CBL": ["cable_sat"],
    SAT: ["cable_sat"],
    MPLAY: ["mediaplayer"],
    TV: ["tvaudio", "tv"],
    GAME: ["game"],
    GAME1: ["game", "game1"],
    GAME2: ["game2"],
    "8K": ["aux_8k"],
    PHONO: ["phono"],
    CD: ["cd"],
    DVD: ["dvd"],
    TUNER: ["tuner"],
    HDRADIO: ["hdradio"],
  };

  /** AVR Control input codes of HEOS music sources (streaming, Bluetooth, USB …): HEOS knows the actual source. */
  private static readonly AVR_STREAMING_INPUTS = [
    "NET",
    "BT",
    "USB",
    "USB/IPOD",
    "IPOD",
    "IPD",
    "SERVER",
    "IRADIO",
    "IRP",
    "FAVORITES",
    "SPOTIFY",
    "AIRPLAY",
    "FVP",
    "MXPORT",
  ];

  /**
   * HEOS input id candidates for an input code reported by AVR Control (e.g. "AUX1" → ["aux1"]).
   * Returns an empty array for HEOS music sources, which are taken from HEOS instead.
   */
  public static heosInputCandidates(avrInput: string): string[] {
    const code = avrInput.trim().toUpperCase();
    if (DenonClientHybrid.AVR_STREAMING_INPUTS.includes(code)) {
      return [];
    }
    return DenonClientHybrid.AVR_TO_HEOS_INPUTS[code] ?? [code.toLowerCase()];
  }

  /**
   * HEOS input id for an input code reported by AVR Control, or undefined if HEOS has to be asked.
   * Prefers a candidate the device actually offers; without a known input list the first candidate is used.
   */
  public static heosInputFromAvrInput(
    avrInput: string,
    knownInputIds: string[],
  ): string | undefined {
    const candidates = DenonClientHybrid.heosInputCandidates(avrInput);
    if (knownInputIds.length === 0) {
      return candidates[0];
    }
    return candidates.find((candidate) => knownInputIds.includes(candidate));
  }

  constructor(
    serialNumber: string,
    name: string,
    host: string,
    connect_timeout: number,
    response_timeout: number,
    debugLogCallback?: (message: string, ...parameters: any[]) => void,
    powerUpdateCallback?: (power: boolean) => void,
    muteUpdateCallback?: (mute: boolean) => void,
    volumeUpdateCallback?: (volume: number) => void,
    inputUpdateCallback?: (input: string) => void,
  ) {
    this.debugLog = debugLogCallback ?? (() => {});
    this.inputUpdateCallback = inputUpdateCallback;
    // HEOS doesn't report an input changed at the receiver itself, AVR Control does ("SI…").
    this.clientAvrControl = new DenonClientAvrControl(
      serialNumber,
      name,
      host,
      connect_timeout,
      response_timeout,
      debugLogCallback,
      powerUpdateCallback,
      undefined,
      undefined,
      inputUpdateCallback
        ? (avrInput) => this.onAvrInputChanged(avrInput)
        : undefined,
    );
    this.clientHeosCli = new DenonClientHeosCli(
      serialNumber,
      name,
      host,
      connect_timeout,
      response_timeout,
      debugLogCallback,
      undefined,
      muteUpdateCallback,
      volumeUpdateCallback,
      inputUpdateCallback,
    );
    this.serialNumber = serialNumber;
    this.name = name;
  }

  public isConnected(): boolean {
    return (
      this.clientAvrControl.isConnected() || this.clientHeosCli.isConnected()
    );
  }

  public getPower(): Promise<boolean> {
    return this.clientAvrControl.getPower();
  }

  /** Time HEOS gets after the device was switched on before playback is resumed (overridable for tests). */
  private resumeDelayMs = 1500;

  public async setPower(power: boolean): Promise<boolean> {
    // The last source is read before switching on. AVR Control knows the receiver's real input (HEOS doesn't notice
    // an input changed on the receiver or with its remote); HEOS is only the fallback (right after waking up, a
    // receiver reports no source there for a while).
    const avrInput = power ? await this.readAvrInput() : undefined;
    const inputBefore = power && avrInput === undefined ? await this.readInput() : undefined;
    const result = await this.clientAvrControl.setPower(power);
    if (power) {
      if (avrInput !== undefined) {
        if (DenonClientHybrid.isHeosMusicSource(avrInput)) {
          await this.resumeHeosPlayback();
        } else {
          this.debugLog(`Switched on, the receiver's input is ${avrInput}: not resuming playback.`);
        }
      } else {
        await this.resumeAfterPowerOn(inputBefore);
      }
    }
    return result;
  }

  /** True if the AVR Control input code is a HEOS music source (network, Bluetooth, USB …), not an input like AUX1 or BD. */
  public static isHeosMusicSource(avrInput: string): boolean {
    return DenonClientHybrid.AVR_STREAMING_INPUTS.includes(avrInput.trim().toUpperCase());
  }

  private async readAvrInput(): Promise<string | undefined> {
    try {
      const input = await this.clientAvrControl.getInput();
      return typeof input === "string" && input.trim() !== "" ? input.trim() : undefined;
    } catch (error) {
      this.debugLog("Could not read the receiver's input via AVR Control:", error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  private async resumeHeosPlayback() {
    try {
      await new Promise((resolve) => setTimeout(resolve, this.resumeDelayMs));
      await this.clientHeosCli.resumePlayback();
    } catch (error) {
      this.debugLog("Could not resume playback after switching on:", error instanceof Error ? error.message : error);
    }
  }

  private async readInput(): Promise<string | undefined> {
    try {
      return await this.clientHeosCli.getInput();
    } catch (error) {
      this.debugLog("Could not read the current source:", error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  /**
   * Like HEOS CLI, switching on continues the music, or starts the power on favorite / Quick Select slot if there
   * is nothing to resume. Not if an input (TV, HDMI, optical …) was the last source: then the device is only switched on.
   */
  private async resumeAfterPowerOn(inputBefore: string | undefined) {
    try {
      if (inputBefore !== undefined && this.isPhysicalInput(inputBefore)) {
        this.debugLog(`Switched on, the last source is the input ${inputBefore}: not resuming playback.`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, this.resumeDelayMs));
      const input = await this.readInput();
      if (input !== undefined && this.isPhysicalInput(input)) {
        this.debugLog(`Switched on, the current source is the input ${input}: not resuming playback.`);
        return;
      }
      await this.clientHeosCli.resumePlayback();
    } catch (error) {
      // the device is on anyway, only the music didn't continue
      this.debugLog("Could not resume playback after switching on:", error instanceof Error ? error.message : error);
    }
  }

  private isPhysicalInput(inputID: string): boolean {
    return (
      this.knownInputIds.includes(inputID) ||
      inputID === "cd" ||
      DenonClientHeosCli.INPUT_SOURCES.some((input) => input.inputID === inputID)
    );
  }

  public setPowerOnFavorite(preset: number, infoLog?: (message: string) => void) {
    this.clientHeosCli.setPowerOnFavorite(preset, infoLog);
  }

  public setPowerOnQuickSelect(slot: number) {
    this.clientHeosCli.setPowerOnQuickSelect(slot);
  }

  public getFavorites(): Promise<string[]> {
    return this.clientHeosCli.getFavorites();
  }

  public getQuickSelects(): Promise<string[]> {
    return this.clientHeosCli.getQuickSelects();
  }

  public getPlaying(raceStatus: RaceStatus): Promise<Playing> {
    return this.clientHeosCli.getPlaying(raceStatus);
  }

  public setPlaying(playing: Playing): Promise<Playing> {
    return this.clientHeosCli.setPlaying(playing);
  }

  public async setPlayNext(): Promise<void> {
    return this.clientHeosCli.setPlayNext();
  }

  public async setPlayPrevious(): Promise<void> {
    return this.clientHeosCli.setPlayPrevious();
  }

  public getMute(raceStatus?: RaceStatus): Promise<boolean> {
    return this.clientHeosCli.getMute(raceStatus);
  }

  public setMute(mute: boolean): Promise<boolean> {
    return this.clientHeosCli.setMute(mute);
  }

  public getVolume(raceStatus?: RaceStatus): Promise<number> {
    return this.clientHeosCli.getVolume(raceStatus);
  }

  public setVolume(volume: number): Promise<number> {
    return this.clientHeosCli.setVolume(volume);
  }

  public setVolumeUp(volumeIncrement: number): Promise<void> {
    return this.clientHeosCli.setVolumeUp(volumeIncrement);
  }

  public setVolumeDown(volumeDecrement: number): Promise<void> {
    return this.clientHeosCli.setVolumeDown(volumeDecrement);
  }

  public getInput(raceStatus?: RaceStatus): Promise<string> {
    return this.clientHeosCli.getInput(raceStatus);
  }

  public async setInput(inputID: string): Promise<string> {
    return this.clientHeosCli.setInput(inputID);
  }

  public async getInputSources(): Promise<DefaultInput[] | undefined> {
    const inputs = await this.clientHeosCli.getInputSources();
    this.knownInputIds = inputs.map((input) => input.inputID);
    return inputs;
  }

  private onAvrInputChanged(avrInput: string) {
    const inputID = DenonClientHybrid.heosInputFromAvrInput(
      avrInput,
      this.knownInputIds,
    );
    if (inputID) {
      this.debugLog(`Input changed on the receiver: ${avrInput} → ${inputID}`);
      this.inputUpdateCallback?.(inputID);
      return;
    }
    // a HEOS music source or an input HEOS doesn't offer: ask HEOS for the current source
    this.clientHeosCli
      .getInput()
      .then((heosInput) => {
        this.debugLog(
          `Input changed on the receiver: ${avrInput} → ${heosInput} (from HEOS)`,
        );
        this.inputUpdateCallback?.(heosInput);
      })
      .catch((error) =>
        this.debugLog(
          `Could not read the current input after the receiver reported ${avrInput}:`,
          error instanceof Error ? error.message : error,
        ),
      );
  }
}
