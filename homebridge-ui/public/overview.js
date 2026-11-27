/**
 * Logic of the device overview on the plugin settings page (no DOM access, also used by the unit tests).
 * Mirrors the rules of the plugin (src/platform.ts): manual entries win, then excluded, then auto-add.
 */

export const PLATFORM = "HeosMultiroomAudio";
export const DEFAULT_NAME = "HEOS Multiroom-Audio";

/** Serial numbers are compared like the plugin compares the excluded ones: trimmed, case-insensitive. */
export const normalizeSerial = (serial) => String(serial ?? "").trim().toUpperCase();

const filled = (value) => typeof value === "string" && value.trim() !== "";

/** Same as isEmptyDeviceEntry() of the plugin: the empty entry the settings form starts with. */
export const isEmptyDeviceEntry = (entry) => !entry || (!filled(entry.name) && !filled(entry.serialNumber) && !filled(entry.ip));

/** Same as discoveryEnabled() of the plugin. */
export function discoveryEnabled(config) {
  if (config.deviceDiscovery === undefined) {
    return config.autoAddDiscoveredDevices === true;
  }
  return config.deviceDiscovery === true;
}

export const autoAddEnabled = (config) => config.autoAddDiscoveredDevices === true && discoveryEnabled(config);

export const isExcluded = (config, serial) =>
  Array.isArray(config.excludedSerialNumbers) && config.excludedSerialNumbers.some((entry) => normalizeSerial(entry) === normalizeSerial(serial));

/**
 * Builds the rows of the overview.
 * @param config the platform config block
 * @param discovered devices reported by the search (serialNumber, ip, modelName, name, controlProtocol)
 * @param scanFinished whether the search is over (only then a manual device can be "not found")
 */
export function buildRows(config, discovered, scanFinished) {
  const rows = [];
  const manualSerials = new Set();
  const found = new Map(discovered.map((device) => [normalizeSerial(device.serialNumber), device]));

  for (const entry of Array.isArray(config.devices) ? config.devices : []) {
    if (isEmptyDeviceEntry(entry) || manualSerials.has(normalizeSerial(entry.serialNumber))) {
      continue;
    }
    manualSerials.add(normalizeSerial(entry.serialNumber));
    const device = found.get(normalizeSerial(entry.serialNumber));
    rows.push({
      serialNumber: entry.serialNumber,
      name: entry.name,
      modelName: device?.modelName,
      ip: entry.ip,
      controlProtocol: entry.controlProtocol,
      status: device || !scanFinished ? "manual" : "manualNotFound",
      actions: [],
    });
  }

  for (const device of discovered) {
    if (manualSerials.has(normalizeSerial(device.serialNumber))) {
      continue;
    }
    const base = { serialNumber: device.serialNumber, name: device.name, modelName: device.modelName, ip: device.ip, controlProtocol: device.controlProtocol };
    if (!device.controlProtocol) {
      rows.push({ ...base, status: "unreachable", actions: [] });
    } else if (isExcluded(config, device.serialNumber)) {
      rows.push({ ...base, status: "excluded", actions: ["include", "edit"] });
    } else if (autoAddEnabled(config)) {
      rows.push({ ...base, status: "auto", actions: ["edit", "exclude"] });
    } else {
      rows.push({ ...base, status: "notAdded", actions: ["setup"] });
    }
  }

  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Returns a copy of the config with a manual entry for the device (replaces the empty entry of the form). */
export function addManualEntry(config, device) {
  const devices = (Array.isArray(config.devices) ? config.devices : []).filter((entry) => !isEmptyDeviceEntry(entry));
  if (devices.some((entry) => normalizeSerial(entry.serialNumber) === normalizeSerial(device.serialNumber))) {
    return config;
  }
  devices.push({ name: device.name, serialNumber: device.serialNumber, ip: device.ip, controlProtocol: device.controlProtocol });
  return { ...config, devices };
}

/** Returns a copy of the config with the device added to or removed from the excluded devices. */
export function setExcluded(config, serial, excluded) {
  const list = (Array.isArray(config.excludedSerialNumbers) ? config.excludedSerialNumbers : []).filter(
    (entry) => normalizeSerial(entry) !== normalizeSerial(serial),
  );
  if (excluded) {
    list.push(serial);
  }
  return { ...config, excludedSerialNumbers: list };
}

export const TEXTS = {
  en: {
    title: "Devices in the network",
    tabSettings: "Settings",
    rescan: "Search again",
    searching: "Searching …",
    searchFailed: "The search failed: {error}",
    intro:
      "Opening this tab searches the network once for Denon / Marantz HEOS devices (also with Device Discovery off). Edit takes a device into Devices (manual setup) on the Settings tab, where you can change e.g. the control protocol; it stays paired in the Home app. Changes are applied with Save.",
    noDevices: "No devices configured or found.",
    colDevice: "Device",
    colAddress: "IP address / serial number",
    colProtocol: "Protocol",
    colStatus: "Status",
    status_manual: "set up manually",
    status_manualNotFound: "set up manually, not found in the network",
    status_auto: "added automatically",
    status_excluded: "excluded",
    status_notAdded: "not added (adding automatically is off)",
    status_unreachable: "not reachable",
    action_edit: "Edit",
    action_setup: "Set up",
    action_exclude: "Exclude",
    action_include: "Include again",
    toastEdit: "'{name}' was added under Devices (manual setup). Open it there, change the settings and click Save.",
    toastExclude: "'{name}' will not be added automatically after saving.",
    toastInclude: "'{name}' was removed from the excluded devices.",
  },
  de: {
    title: "Geräte im Netzwerk",
    tabSettings: "Einstellungen",
    rescan: "Neu suchen",
    searching: "Suche läuft …",
    searchFailed: "Die Suche ist fehlgeschlagen: {error}",
    intro:
      "Beim Öffnen dieses Reiters wird einmal im Netzwerk nach Denon- und Marantz-HEOS-Geräten gesucht (auch bei ausgeschalteter Geräteerkennung). „Bearbeiten“ übernimmt ein Gerät im Reiter „Einstellungen“ in „Geräte (manuelle Einrichtung)“, dort kannst du z. B. das Steuerprotokoll ändern; in der Home-App bleibt es erhalten. Änderungen gelten nach „Speichern“.",
    noDevices: "Keine Geräte konfiguriert oder gefunden.",
    colDevice: "Gerät",
    colAddress: "IP-Adresse / Seriennummer",
    colProtocol: "Protokoll",
    colStatus: "Status",
    status_manual: "manuell eingerichtet",
    status_manualNotFound: "manuell eingerichtet, im Netzwerk nicht gefunden",
    status_auto: "automatisch hinzugefügt",
    status_excluded: "ausgeschlossen",
    status_notAdded: "nicht hinzugefügt (automatisches Hinzufügen aus)",
    status_unreachable: "nicht erreichbar",
    action_edit: "Bearbeiten",
    action_setup: "Einrichten",
    action_exclude: "Ausschließen",
    action_include: "Wieder aufnehmen",
    toastEdit: "„{name}“ steht jetzt unter „Geräte (manuelle Einrichtung)“. Klappe den Abschnitt auf, ändere die Einstellungen und klicke auf „Speichern“.",
    toastExclude: "„{name}“ wird nach dem Speichern nicht mehr automatisch hinzugefügt.",
    toastInclude: "„{name}“ ist nicht mehr ausgeschlossen.",
  },
};

export function texts(language) {
  return TEXTS[String(language ?? "").slice(0, 2)] ?? TEXTS.en;
}

export const format = (text, values) => text.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? ""));
