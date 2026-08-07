import { useEffect } from "react";
import { Stack } from "expo-router";
import type { ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "@road-crew/ui";
import { SessionProvider, useSession } from "@/auth/SessionProvider";
import { usePushRegistration } from "@/push/usePushRegistration";
import { theme } from "@road-crew/ui";
import { initMonitoring, captureError } from "@/monitoring";
import "@/field/backgroundLocation";
import "@/sync/backgroundHeartbeat";
import "@/push/backgroundNotification";

/**
 * Expo Router picks up this named export as the app-wide error boundary, so a
 * render crash shows the message instead of a white screen.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    captureError(error, { tags: { source: "error_boundary" } });
  }, [error]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: "center" }}>
      <Text style={{ color: colors.brandRed, fontSize: 18, fontWeight: "800", marginBottom: 10 }}>
        Something went wrong
      </Text>
      <ScrollView style={{ maxHeight: 220, marginBottom: 16 }}>
        <Text style={{ color: colors.text, fontSize: 13 }}>{error.message}</Text>
      </ScrollView>
      <Text onPress={retry} style={{ color: colors.brandRed, fontSize: 15, fontWeight: "700" }}>
        Try again
      </Text>
    </View>
  );
}

function RootNavigator() {
  const { vanId } = useSession();
  // Register for push as soon as a van is selected (groundwork for #155).
  usePushRegistration(vanId);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="van-install" options={{ headerShown: false }} />
      <Stack.Screen name="(field)" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ title: "Choose your van" }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="chat/[vanId]" options={{ title: "Command" }} />
    </Stack>
  );
}

export default function RootLayout() {
  // Boot error monitoring/logging as early as possible.
  useEffect(() => {
    initMonitoring();
  }, []);

  // Register the offline service worker on web (no-op on native / unsupported).
  useEffect(() => {
    if (Platform.OS === "web" && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((e) => captureError(e, { tags: { source: "sw_register" } }));
    }
  }, []);

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
