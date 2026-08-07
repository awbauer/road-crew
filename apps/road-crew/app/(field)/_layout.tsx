import { FontAwesome6 } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { colors } from "@road-crew/ui";
import { RouteSelectionProvider } from "@/field/RouteSelection";
import { RoutesProvider } from "@/field/useRoutes";
import { StatusSheetProvider } from "@/field/StatusSheet";
import { SettingsProvider } from "@/field/Settings";
import { GeolocationProvider } from "@/field/Geolocation";
import { HeartbeatProvider } from "@/update/HeartbeatProvider";
import { AppUpdateChecker } from "@/update/AppUpdateChecker";
import { UpdatedToast } from "@/update/UpdatedToast";
import { NotificationsProvider } from "@/notifications/NotificationsProvider";
import { NotificationCenter } from "@/notifications/NotificationCenter";
import { NotificationBanners } from "@/notifications/NotificationBanners";
import { HighSeverityNotice } from "@/notifications/HighSeverityNotice";
import { RouteChangedToast } from "@/field/RouteChangedToast";
import { useTabletRouteWorkspace } from "@/field/useTabletRouteWorkspace";

/**
 * Field-guide tab bar. Phones expose Home / Sequences / Map; tablets expose
 * Home / Route, where Route is the dedicated combined list/map workspace.
 * Command is intentionally absent (it is opt-in / deferred).
 */
export default function FieldTabsLayout() {
  // On tablet-sized screens the sequence list + map share one Route workspace,
  // regardless of orientation, so the standalone Map tab is hidden.
  const isTablet = useTabletRouteWorkspace();

  return (
    <SettingsProvider>
      <RoutesProvider>
        <RouteSelectionProvider>
          <GeolocationProvider>
            <HeartbeatProvider>
              <NotificationsProvider>
                <AppUpdateChecker />
                <StatusSheetProvider>
                  <UpdatedToast />
                  <RouteChangedToast />
                  <NotificationCenter />
                  <HighSeverityNotice />
                  <NotificationBanners />
                  <Tabs
                    screenOptions={{
                      headerShown: false,
                      tabBarStyle: {
                        backgroundColor: colors.bg,
                        borderTopColor: colors.border,
                      },
                      tabBarActiveTintColor: colors.text,
                      tabBarInactiveTintColor: colors.textSubtle,
                    }}
                  >
                    <Tabs.Screen
                      name="home"
                      options={{
                        title: "Home",
                        tabBarIcon: ({ color, size }) => <FontAwesome6 name="house" color={color} size={size} />,
                      }}
                    />
                    <Tabs.Screen
                      name="sequences"
                      options={{
                        title: "Sequences",
                        tabBarIcon: ({ color, size }) => <FontAwesome6 name="route" color={color} size={size} />,
                        href: isTablet ? null : undefined,
                      }}
                    />
                    <Tabs.Screen
                      name="map"
                      options={{
                        title: "Map",
                        tabBarIcon: ({ color, size }) => <FontAwesome6 name="compass" color={color} size={size} />,
                        // Hidden on tablet screens — the map lives in the shared Route workspace.
                        href: isTablet ? null : undefined,
                      }}
                    />
                    <Tabs.Screen
                      name="route"
                      options={{
                        title: "Route",
                        tabBarIcon: ({ color, size }) => <FontAwesome6 name="route" color={color} size={size} />,
                        href: isTablet ? undefined : null,
                      }}
                    />
                  </Tabs>
                </StatusSheetProvider>
              </NotificationsProvider>
            </HeartbeatProvider>
          </GeolocationProvider>
        </RouteSelectionProvider>
      </RoutesProvider>
    </SettingsProvider>
  );
}
