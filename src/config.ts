/**
 * Typed representation of the plugin configuration (see config.schema.json).
 */

export interface InputConfig {
  inputID: string;
  name: string;
  showInList?: boolean;
}

/**
 * A device entry without name, serial number and IP address. The Homebridge settings form starts with such an
 * entry (only default values) and saves it if the user doesn't remove it: it is ignored, not reported as an error.
 */
export function isEmptyDeviceEntry(entry: Partial<DeviceConfig> | null | undefined): boolean {
  const filled = (value: unknown) => typeof value === "string" && value.trim() !== "";
  return !entry || (!filled(entry.name) && !filled(entry.serialNumber) && !filled(entry.ip));
}

export interface DeviceConfig {
  name: string;
  serialNumber: string;
  ip: string;
  controlProtocol: "AVRCONTROL" | "HEOSCLI" | "HYBRID";
  volumeLimitEnabled?: boolean;
  volumeLimit?: number;
  volumeStepSize?: number;
  powerOnFavorite?: number;
  powerOnQuickSelect?: number;
  inputs?: InputConfig[];
  /** Writes the debug messages of this device to the normal log (troubleshooting). */
  debug?: boolean;
}
