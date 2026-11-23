import type { API } from "homebridge";

import { DenonAudioPlatform, LegacyDenonAudioPlatform } from "./platform.js";
import { LEGACY_PLATFORM_NAME, PLATFORM_NAME } from "./settings.js";

/**
 * This method registers the platform with Homebridge
 */
export default (api: API) => {
  api.registerPlatform(PLATFORM_NAME, DenonAudioPlatform);
  // configurations of version 1.x keep working until the platform name is changed
  api.registerPlatform(LEGACY_PLATFORM_NAME, LegacyDenonAudioPlatform);
};
