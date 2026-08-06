import { useEffect } from "react";
import { Redirect } from "expo-router";
import { useSession } from "@/auth/SessionProvider";
import { shouldInitializeVanInstall, shouldShowVanInstall } from "@/auth/vanInstallMode.js";
import { CONFIG } from "@/config";

/**
 * v1 opens directly to the field guide (Home / Sequences / Map). The field
 * guide needs no sign-in — van selection lives in app status.
 *
 * Exception: native builds persist van install as an app attribute
 * and route to the van-install picker any time this device has no selected van
 * and has not skipped setup. The hosted web app cannot expose the picker.
 */
export default function Index() {
  const { ready, vanId, vanInstall, vanInstallConfigured, vanInstallSkipped, enableVanInstall } = useSession();
  const buildVanInstall = CONFIG.vanInstallEnabled;

  useEffect(() => {
    if (!ready || !shouldInitializeVanInstall({ buildVanInstall, vanInstallConfigured })) return;
    void enableVanInstall();
  }, [ready, buildVanInstall, vanInstallConfigured, enableVanInstall]);

  // Wait for the persisted session before deciding, so we don't flash the
  // picker for a device that already has a van.
  if (!ready) return null;

  if (shouldShowVanInstall({
    vanId,
    vanInstall,
    vanInstallConfigured,
    vanInstallSkipped,
    buildVanInstall,
  })) {
    return <Redirect href="/van-install" />;
  }

  return <Redirect href="/(field)/home" />;
}
