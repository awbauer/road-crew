import { FontAwesome6 } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { theme } from "@road-crew/ui";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Chat",
          tabBarIcon: ({ color, size }) => <FontAwesome6 name="comments" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="routes"
        options={{
          title: "Route",
          tabBarIcon: ({ color, size }) => <FontAwesome6 name="route" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
