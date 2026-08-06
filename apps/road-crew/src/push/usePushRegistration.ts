import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { router } from "expo-router";
import {
  acquirePushTokens,
  configureNotificationHandler,
  registerPushToken,
} from "@/push/registration";
import { recordPushTokenAcquired } from "@/push/diagnostics";
import { addBreadcrumb, captureError } from "@/monitoring";

/**
 * Wires push notifications for the signed-in van:
 *  - configures foreground presentation + badge behavior,
 *  - acquires and registers the native token for silent Command sync wakes,
 *  - retains the existing tap listener for future visible Command alerts.
 *
 * Visible notification payloads may carry `{ vanId }` in `data`.
 */
export function usePushRegistration(vanId: string | null): void {
  useEffect(() => {
    configureNotificationHandler();
  }, []);

  // Acquire + register the token whenever the active van changes.
  useEffect(() => {
    if (!vanId) return;
    let cancelled = false;
    const tokenSubscription = Platform.OS === "ios"
        ? Notifications.addPushTokenListener((token) => {
          if (cancelled) return;
          // iOS can rotate an APNs token after boot. Keep this path visible in
          // the export even though it skips acquirePushTokens().
          void recordPushTokenAcquired("token-refresh", String(token.data));
          void registerPushToken(vanId, {
            expoPushToken: null,
            devicePushToken: String(token.data),
            platform: Platform.OS,
          }, "token-refresh").catch((error) => {
            captureError(error, { tags: { source: "push_token_refresh" }, extra: { vanId } });
          });
        })
      : null;
    acquirePushTokens("boot")
      // Returned, not fired and forgotten: a `void` here would leave a failed
      // registration as an unhandled rejection instead of reaching `.catch`.
      .then((tokens) => (cancelled ? undefined : registerPushToken(vanId, tokens, "boot")))
      .catch((error) => {
        captureError(error, { tags: { source: "push_registration_boot" }, extra: { vanId } });
      });
    return () => {
      cancelled = true;
      tokenSubscription?.remove();
    };
  }, [vanId]);

  // Deep link: tapping a chat notification opens that conversation.
  useEffect(() => {
    const routeToConversation = (data: Record<string, unknown> | undefined) => {
      const targetVan = data && typeof data.vanId === "string" ? data.vanId : null;
      if (targetVan) router.push(`/chat/${encodeURIComponent(targetVan)}`);
    };

    // Cold start from a notification tap.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        routeToConversation(response?.notification.request.content.data as Record<string, unknown>);
      })
      .catch((error) => {
        captureError(error, { tags: { source: "push_last_notification" } });
      });

    // Taps while the app is running.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      addBreadcrumb("push notification opened", {
        hasVanId: typeof response.notification.request.content.data?.vanId === "string",
      });
      routeToConversation(response.notification.request.content.data as Record<string, unknown>);
    });
    return () => sub.remove();
  }, []);
}
