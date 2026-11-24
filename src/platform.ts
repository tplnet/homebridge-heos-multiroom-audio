import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from "homebridge";

import { DenonAudioAccessory as DenonAudioAccessory } from "./platformAccessory.js";
import * as CustomLogging from "./customLogging.js";
import { LEGACY_PLATFORM_NAME, PLATFORM_NAME, PLUGIN_NAME } from "./settings.js";
import * as DenonProtocol from "./denonProtocol.js";
import type { DeviceConfig } from "./config.js";
import { buildDiscoveredDeviceConfig } from "./discovery.js";
import { checkControlProtocol } from "./protocolCheck.js";
import { DiscoveredHeosDevice, HeosDiscovery } from "./heosDiscovery.js";
import { DeviceOverview, DeviceStatus } from "./deviceOverview.js";

const MINUTE = 60 * 1000;
// first overview after the discovery started, later updates after new devices were found
const OVERVIEW_FIRST_DELAY_MS = 30 * 1000;
const OVERVIEW_UPDATE_DELAY_MS = 10 * 1000;
// devices found within this time after the start are published together with the manual ones, in a fixed order
const INITIAL_DISCOVERY_WINDOW_MS = 10 * 1000;

export class DenonAudioPlatform implements DynamicPlatformPlugin {
  /** Platform name this instance was registered with (see LegacyDenonAudioPlatform). */
  protected get platformName(): string {
    return PLATFORM_NAME;
  }

  public readonly rawLog: Logger;
  public readonly log: Logger;
  public readonly config: PlatformConfig;
  public readonly api: API;

  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  private readonly ssdpSeenSerialNumbers = new Set<string>();
  // serial numbers of devices set up from the manual configuration or by auto-add
  private readonly activeSerialNumbers = new Set<string>();

  // device discovery
  private discoveryFactory: () => HeosDiscovery = () =>
    new HeosDiscovery({ debugLog: this.log.debug.bind(this.log) });
  private activeDiscovery: HeosDiscovery | undefined;
  private discoveryRestartDelaysMs = [
    1 * MINUTE,
    5 * MINUTE,
    15 * MINUTE,
    30 * MINUTE,
  ];
  private discoveryRestartTimer: NodeJS.Timeout | undefined;
  // ends the current discovery session or restart delay immediately (used on shutdown)
  private interruptDiscovery: (() => void) | undefined;
  private shuttingDown = false;

  // overview of all devices, logged after the discovery
  public readonly deviceOverview = new DeviceOverview();
  private overviewTimer: NodeJS.Timeout | undefined;
  private overviewLogged = false;

  // Homebridge assigns the ports of external accessories in the order they are published. Publishing the devices
  // of the start together, sorted by serial number, gives every device the same port at every start
  // (as long as the same devices are there), so Apple Home finds them again right away.
  private initialWindowOpen = true;
  private initialPublishDone = false;
  private initialWindowTimer: NodeJS.Timeout | undefined;
  private readonly pendingInitialSetups = new Set<Promise<unknown>>();
  private readonly readyToPublish: PlatformAccessory[] = [];

  constructor(log: Logger, config: PlatformConfig, api: API) {
    // The Homebridge UI ("Plugin Logs") shows the lines prefixed with the configured name, or the package name without one.
    this.rawLog = config.consoleLogEnabled
      ? new CustomLogging.ConsoleLogger(
          CustomLogging.logLevelFromString[config.consoleLogLevel] ??
            CustomLogging.logLevelFromString.debug,
          config.name || PLUGIN_NAME,
          true,
        )
      : log;
    this.log = new CustomLogging.LoggerPrefixWrapper(this.rawLog, "Platform");
    if (!config.name && !config.consoleLogEnabled) {
      this.log.info(
        'No name set in the plugin settings: the Homebridge UI can\'t show the log of this plugin under "Plugin Logs". Open the plugin settings and save them once.',
      );
    }
    this.config = config;
    this.api = api;

    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.log.debug("Finished initializing platform:", this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired, in order to ensure they weren't added to homebridge already.
    // This event can also be used to start discovery of new accessories.
    this.api.on("didFinishLaunching", () => {
      log.debug("Executed didFinishLaunching callback");
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });

    this.api.on("shutdown", () => {
      this.shuttingDown = true;
      clearTimeout(this.discoveryRestartTimer);
      clearTimeout(this.overviewTimer);
      clearTimeout(this.initialWindowTimer);
      this.activeDiscovery?.stop();
      this.interruptDiscovery?.();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.debug("Loading accessory from cache:", accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * Removes the accessories restored from the Homebridge cache. They come from an older version
   * that published the devices on the bridge; today every device is an external accessory.
   */
  private removeCachedAccessories() {
    const cached = Array.from(this.accessories.values());
    if (cached.length === 0) {
      return;
    }
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, this.platformName, cached);
    this.accessories.clear();
    this.log.info(
      `Removed ${cached.length} accessor${cached.length === 1 ? "y" : "ies"} of an older plugin version from the Homebridge cache (${cached.map((a) => a.displayName).join(", ")}). The devices are published again as TV accessories.`,
    );
  }

  discoverDevices() {
    // The devices are TV accessories, published as external accessories, which Homebridge doesn't cache.
    // Accessories in the cache come from an older version that published them on the bridge: remove them,
    // every device is published fresh below.
    this.removeCachedAccessories();

    // loop over the configured devices and publish each one
    if (this.config.devices) {
      for (const deviceConfig of this.config.devices as DeviceConfig[]) {
        if (this.activeSerialNumbers.has(deviceConfig.serialNumber)) {
          this.log.warn(
            `Device with serial number ${deviceConfig.serialNumber} is configured more than once. Skipping '${deviceConfig.name}'.`,
          );
          continue;
        }
        this.activeSerialNumbers.add(deviceConfig.serialNumber);
        this.deviceOverview.addManual(deviceConfig);

        // the UUID is derived from the serial number, so the Home app pairing stays the same
        const uuid = this.api.hap.uuid.generate(deviceConfig.serialNumber);
        this.log.info("Adding new accessory:", deviceConfig.name);
        const accessory = new this.api.platformAccessory(
          deviceConfig.name,
          uuid,
        );
        this.publishNewAccessory(deviceConfig, accessory);
      }
    }

    if (this.discoveryEnabled()) {
      this.scheduleOverview(OVERVIEW_FIRST_DELAY_MS);
      this.initialWindowTimer = setTimeout(
        () => this.closeInitialWindow(),
        INITIAL_DISCOVERY_WINDOW_MS,
      );
      this.initialWindowTimer.unref?.();
      this.runDeviceDiscovery().catch((error) => {
        this.log.warn(
          "Device discovery stopped unexpectedly. New devices will no longer be discovered.",
          error,
        );
      });
    } else {
      this.closeInitialWindow();
    }
  }

  /** Tracks a setup started before the first publish, so that the first publish waits for it. */
  private trackInitialSetup(setup: Promise<unknown>) {
    if (this.initialPublishDone) {
      return;
    }
    this.pendingInitialSetups.add(setup);
    void setup.finally(() => {
      this.pendingInitialSetups.delete(setup);
      this.publishInitialAccessories();
    });
  }

  closeInitialWindow() {
    this.initialWindowOpen = false;
    this.publishInitialAccessories();
  }

  /** Publishes the accessories of the start in one call, sorted by serial number (stable ports). */
  private publishInitialAccessories() {
    if (
      this.initialPublishDone ||
      this.initialWindowOpen ||
      this.pendingInitialSetups.size > 0
    ) {
      return;
    }
    this.initialPublishDone = true;
    const serial = (accessory: PlatformAccessory) =>
      String(accessory.context.device?.serialNumber ?? "");
    const accessories = this.readyToPublish
      .splice(0)
      .sort((a, b) => serial(a).localeCompare(serial(b)));
    if (accessories.length > 0) {
      this.log.debug(
        "Publishing accessories in this order (ports are assigned in this order):",
        accessories.map((a) => a.displayName).join(", "),
      );
      this.api.publishExternalAccessories(PLUGIN_NAME, accessories);
    }
  }

  private publishAccessory(accessory: PlatformAccessory) {
    if (this.initialPublishDone) {
      // found later: published right away (gets the next free port)
      this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
    } else {
      this.readyToPublish.push(accessory);
    }
  }

  private discoveryEnabled(): boolean {
    return this.config.deviceDiscovery === true || this.autoAddEnabled();
  }

  /** Logs the device overview after the delay (restarts the delay if called again before). */
  private scheduleOverview(delayMs: number) {
    clearTimeout(this.overviewTimer);
    this.overviewTimer = setTimeout(() => {
      this.overviewLogged = true;
      this.logOverview();
    }, delayMs);
    this.overviewTimer.unref?.();
  }

  logOverview() {
    for (const line of this.deviceOverview.format(this.discoveryEnabled())) {
      this.log.info(line);
    }
  }

  private autoAddEnabled(): boolean {
    return this.config.autoAddDiscoveredDevices === true;
  }

  private isExcluded(serialNumber: string): boolean {
    const excluded: unknown = this.config.excludedSerialNumbers;
    return (
      Array.isArray(excluded) &&
      excluded.some(
        (entry) =>
          String(entry).trim().toUpperCase() === serialNumber.toUpperCase(),
      )
    );
  }

  /**
   * Sets up a new accessory and publishes it as external accessory
   * (HomeKit only allows one television accessory per bridge).
   */
  private publishNewAccessory(
    deviceConfig: DeviceConfig,
    accessory: PlatformAccessory,
    supportedModes?: DenonProtocol.ControlMode[],
  ) {
    // store a copy of the device object in the `accessory.context`
    accessory.context.device = deviceConfig;
    const setup = this.withCheckedProtocol(deviceConfig, supportedModes)
      .then(async (checkedConfig) => {
        const handler = this.createAccessoryHandler(accessory, checkedConfig);
        if (!handler) {
          return;
        }
        // the inputs are read from the device first, as the services of a published accessory should not change anymore
        await handler
          .setupInputs()
          .catch((error) =>
            this.log.error(
              `Could not set up the inputs of '${deviceConfig.name}':`,
              error,
            ),
          );
        this.publishAccessory(accessory);
      })
      .catch((error) =>
        this.log.error(`Could not set up '${deviceConfig.name}':`, error),
      );
    this.trackInitialSetup(setup);
  }

  /**
   * Checks the configured control protocol against the protocols the device supports and falls back to a supported
   * one if necessary (with a warning). If the device can't be reached, the configuration is used unchanged.
   */
  private async withCheckedProtocol(
    deviceConfig: DeviceConfig,
    knownSupportedModes?: DenonProtocol.ControlMode[],
  ): Promise<DeviceConfig> {
    const deviceLog = deviceConfig.debug === true ? new CustomLogging.LoggerPrefixWrapper(this.log, deviceConfig.name, true) : undefined;
    const supportedModes =
      knownSupportedModes ??
      (await DenonProtocol.checkProtocolSupport(
        deviceConfig.ip,
        deviceLog ? deviceLog.debug.bind(deviceLog) : this.log.debug.bind(this.log),
      ));
    if (deviceLog) {
      deviceLog.info(
        `Protocols supported by the device (${deviceConfig.ip}): ${supportedModes.map((mode) => DenonProtocol.ControlMode[mode]).join(", ") || "none (not reachable)"}`,
      );
    }
    const result = checkControlProtocol(
      deviceConfig.name,
      deviceConfig.controlProtocol,
      supportedModes,
    );
    if (result.warning) {
      this.log.warn(result.warning);
    }
    if (result.hint) {
      this.log.info(result.hint);
    }
    if (supportedModes.length === 0) {
      this.log.debug(
        `Could not check the protocols of '${deviceConfig.name}' (${deviceConfig.ip} not reachable). Using the configuration.`,
      );
    }
    return result.protocol === deviceConfig.controlProtocol
      ? deviceConfig
      : { ...deviceConfig, controlProtocol: result.protocol };
  }

  /**
   * Adds a discovered device as new accessory, unless it is configured manually, excluded or already set up.
   */
  private autoAddDiscoveredDevice(
    serialNumber: string,
    ip: string,
    friendlyName: string | undefined,
    modelName: string | undefined,
    supportedModes: DenonProtocol.ControlMode[],
  ): { status: DeviceStatus; name?: string; protocol?: string } {
    if (this.activeSerialNumbers.has(serialNumber)) {
      this.log.debug(
        `Device ${serialNumber} is configured manually. Using the manual configuration.`,
      );
      return { status: "manual" };
    }
    if (this.isExcluded(serialNumber)) {
      this.log.debug(
        `Device ${serialNumber} is excluded from automatic adding.`,
      );
      return { status: "excluded" };
    }

    const deviceConfig = buildDiscoveredDeviceConfig({
      serialNumber,
      ip,
      friendlyName,
      modelName,
      supportedModes,
    });
    if (!deviceConfig) {
      return { status: "unsupported" };
    }

    this.activeSerialNumbers.add(serialNumber);
    this.log.info(
      `Automatically adding discovered device '${deviceConfig.name}' (${deviceConfig.controlProtocol}, ${ip}).`,
    );
    this.publishNewAccessory(
      deviceConfig,
      new this.api.platformAccessory(
        deviceConfig.name,
        this.api.hap.uuid.generate(serialNumber),
      ),
      supportedModes,
    );
    return {
      status: "auto",
      name: deviceConfig.name,
      protocol: deviceConfig.controlProtocol,
    };
  }

  /**
   * Creates the accessory handler. Configuration errors are logged instead of being thrown,
   * so that a single misconfigured device does not prevent the other devices (or Homebridge) from starting.
   * @returns the accessory handler, or undefined if the configuration is invalid
   */
  private createAccessoryHandler(
    accessory: PlatformAccessory,
    deviceConfig: DeviceConfig,
  ): DenonAudioAccessory | undefined {
    try {
      return new DenonAudioAccessory(
        this,
        accessory,
        deviceConfig,
        this.rawLog,
      );
    } catch (error) {
      this.log.error(
        `Could not set up device '${deviceConfig.name}':`,
        error instanceof Error ? error.message : error,
      );
      return undefined;
    }
  }

  /**
   * Keeps the SSDP device discovery running for the whole lifetime of the plugin.
   * If the discovery service fails (e.g. network interface changes), it is restarted with an increasing delay.
   */
  async runDeviceDiscovery() {
    let failures = 0;
    while (!this.shuttingDown) {
      const startedAt = Date.now();
      const error = await this.discoverSsdpDevices();
      if (this.shuttingDown) {
        return;
      }

      if (Date.now() - startedAt > 30 * MINUTE) {
        failures = 0; // it ran fine for a while, start over with the shortest delay
      }
      const delay =
        this.discoveryRestartDelaysMs[
          Math.min(failures, this.discoveryRestartDelaysMs.length - 1)
        ];
      failures++;

      const reason =
        error instanceof Error
          ? error.message
          : error !== undefined
            ? String(error)
            : "discovery ended";
      this.log.warn(
        `Device discovery stopped (${reason}). Restarting in ${Math.max(1, Math.round(delay / MINUTE))} min.`,
      );
      this.log.debug("Error that stopped the device discovery:", error);

      await new Promise<void>((resolve) => {
        this.interruptDiscovery = resolve;
        this.discoveryRestartTimer = setTimeout(resolve, delay);
        this.discoveryRestartTimer.unref?.();
      });
      this.interruptDiscovery = undefined;
    }
  }

  /**
   * Runs one discovery session.
   * @returns a promise that resolves with the socket error that ended the session (undefined if it was interrupted)
   */
  async discoverSsdpDevices(): Promise<unknown> {
    const discovery = this.discoveryFactory();
    this.activeDiscovery = discovery;
    try {
      return await new Promise<unknown>((resolve) => {
        this.interruptDiscovery = () => resolve(undefined);
        discovery.on("error", resolve);
        discovery.on("device", (device: DiscoveredHeosDevice) => {
          const check = this.checkDiscoveredDevice(device).catch((error) => {
            // a single misbehaving device must not stop the discovery
            this.log.debug("Error while checking a discovered device:", error);
          });
          if (this.initialWindowOpen) {
            // a device found within the window is published with the others, even if its check takes longer
            this.trackInitialSetup(check);
          }
        });
        discovery.start().catch(resolve);
      });
    } finally {
      this.interruptDiscovery = undefined;
      this.activeDiscovery = undefined;
      discovery.stop();
    }
  }

  async checkDiscoveredDevice(device: DiscoveredHeosDevice) {
    const serial = device.serialNumber;
    if (this.ssdpSeenSerialNumbers.has(serial)) {
      return;
    }
    this.ssdpSeenSerialNumbers.add(serial);

    this.log.debug("Checking protocol support for:", device.ip);
    const supportedModes = await DenonProtocol.checkProtocolSupport(
      device.ip,
      this.log.debug.bind(this.log),
    );
    const heosName = device.friendlyName ?? device.modelName ?? serial;
    if (supportedModes.length === 0) {
      this.recordDiscovered(device, { status: "unreachable", name: heosName });
      return;
    }

    // listed in the device overview; the details per device only in the debug log
    this.log.debug(
      `Found device '${device.friendlyName ?? "unknown"}' (${device.modelName ?? "unknown model"}), serial number ${serial}, ` +
        `IP address ${device.ip}, supported modes: ${supportedModes.map((mode) => DenonProtocol.ControlMode[mode]).join(", ")}`,
    );

    if (this.autoAddEnabled()) {
      const result = this.autoAddDiscoveredDevice(
        serial,
        device.ip,
        device.friendlyName,
        device.modelName,
        supportedModes,
      );
      this.recordDiscovered(device, {
        ...result,
        name: result.name ?? heosName,
      });
    } else {
      this.recordDiscovered(device, {
        status: this.activeSerialNumbers.has(serial)
          ? "manual"
          : "autoAddDisabled",
        name: heosName,
        protocol: buildDiscoveredDeviceConfig({ ...device, supportedModes })
          ?.controlProtocol,
      });
    }
  }

  private recordDiscovered(
    device: DiscoveredHeosDevice,
    result: { status: DeviceStatus; name: string; protocol?: string },
  ) {
    this.deviceOverview.addDiscovered({
      serialNumber: device.serialNumber,
      model: device.modelName,
      ip: device.ip,
      ...result,
    });
    if (this.overviewLogged) {
      // a device found later (e.g. switched on hours after the start): log the updated overview
      this.scheduleOverview(OVERVIEW_UPDATE_DELAY_MS);
    }
  }
}

/**
 * The platform under its name of version 1.x ("DenonHeosAudio"). Works like DenonAudioPlatform,
 * but asks the user to switch to the new name.
 */
export class LegacyDenonAudioPlatform extends DenonAudioPlatform {
  protected override get platformName(): string {
    return LEGACY_PLATFORM_NAME;
  }

  constructor(log: Logger, config: PlatformConfig, api: API) {
    super(log, config, api);
    this.log.warn(
      `The platform name "${LEGACY_PLATFORM_NAME}" in config.json is outdated. In the Homebridge UI open "JSON Config" in the main menu (not the one of this plugin, which doesn't show this configuration), change "platform": "${LEGACY_PLATFORM_NAME}" to "platform": "${PLATFORM_NAME}", save and restart with "Restart HB Service & UI". Until then the plugin settings form doesn't show this configuration. Everything else keeps working, also the pairing in the Home app.`,
    );
  }
}
