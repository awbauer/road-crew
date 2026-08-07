import * as Device from "expo-device";
import { Platform } from "react-native";

/** Hardware form factor, as reported to Command in the heartbeat. */
export type DeviceFormFactor = "phone" | "tablet" | "desktop" | "unknown";

/**
 * The device's form factor.
 *
 * `Platform.OS` only identifies the OS, so an iPhone and an iPad are both
 * "ios". Command needs to tell a van's iPad from a crew phone, so this reports
 * the hardware class alongside it.
 *
 * `Platform.isPad` backs up `Device.deviceType`, which can come back UNKNOWN on
 * an iPad running an app built for iPhone.
 */
export function currentDeviceType(): DeviceFormFactor {
  if (Platform.OS === "ios" && Platform.isPad) return "tablet";
  switch (Device.deviceType) {
    case Device.DeviceType.PHONE:
      return "phone";
    case Device.DeviceType.TABLET:
      return "tablet";
    case Device.DeviceType.DESKTOP:
      return "desktop";
    default:
      return "unknown";
  }
}

/** True when this device is a tablet (iPad or an Android tablet). */
export function isTabletDevice(): boolean {
  return currentDeviceType() === "tablet";
}
