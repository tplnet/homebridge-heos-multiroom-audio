/**
 * Server part of the plugin settings page (Homebridge UI custom UI).
 * Runs only while the settings of the plugin are open in the Homebridge UI.
 * Searches the network for HEOS devices with the same code as the plugin and reports each device found to the page.
 */
import { HomebridgePluginUiServer } from "@homebridge/plugin-ui-utils";

import { HeosDiscovery } from "../dist/heosDiscovery.js";
import { checkProtocolSupport } from "../dist/denonProtocol.js";
import { buildDiscoveredDeviceConfig } from "../dist/discovery.js";

const SCAN_DURATION_MS = 10_000; // same as the discovery window of the plugin at startup
const SEARCH_INTERVAL_MS = 3_000; // repeat the M-SEARCH a few times, SSDP is UDP

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.scanId = 0;
    this.stopScan = undefined;
    this.onRequest("/scan", (payload) => this.startScan(payload?.scanId));
    this.ready();
  }

  /** Starts a new search (a running one is stopped). The devices are reported with push events. */
  startScan(requestedId) {
    this.stopScan?.();
    // the page passes its own id, so it can match device events that arrive before the response
    const scanId = requestedId ?? this.scanId + 1;
    this.scanId = scanId;
    const discovery = new HeosDiscovery({ searchIntervalMs: SEARCH_INTERVAL_MS });
    const seen = new Set();
    const checks = [];
    let finished = false;

    const finish = async (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      discovery.stop();
      await Promise.allSettled(checks);
      if (scanId === this.scanId) {
        this.pushEvent("scan-done", { scanId, error: error ? String(error.message ?? error) : undefined });
      }
    };
    const timer = setTimeout(() => finish(), SCAN_DURATION_MS);
    this.stopScan = () => finish();

    discovery.on("error", (error) => finish(error));
    discovery.on("device", (device) => {
      if (seen.has(device.serialNumber)) {
        return;
      }
      seen.add(device.serialNumber);
      checks.push(
        checkProtocolSupport(device.ip)
          .then((supportedModes) => {
            const config = buildDiscoveredDeviceConfig({ ...device, supportedModes });
            if (scanId === this.scanId) {
              this.pushEvent("device", {
                scanId,
                serialNumber: device.serialNumber,
                ip: device.ip,
                modelName: device.modelName,
                name: config?.name ?? device.friendlyName ?? device.modelName ?? device.serialNumber,
                controlProtocol: config?.controlProtocol,
              });
            }
          })
          .catch(() => {}),
      );
    });
    discovery.start().catch((error) => finish(error));
    return { scanId, durationMs: SCAN_DURATION_MS };
  }
}

(() => new UiServer())();
