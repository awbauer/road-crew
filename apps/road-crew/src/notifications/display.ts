import type { FontAwesome6 } from "@expo/vector-icons";
import type { SanitizedNotification } from "@road-crew/core";

export function iconFor(n: Pick<SanitizedNotification, "type" | "action" | "severity">): React.ComponentProps<typeof FontAwesome6>["name"] {
  if (n.action?.kind === "go-to-sequence") return "location-arrow";
  if (n.type === "go-to-sequence") return "location-arrow";
 // if (n.type === "app-update") return "arrow-rotate-right";
  if (n.severity === "high") return "triangle-exclamation";
  return "circle-info";
}

export function actionLabelFor(n: Pick<SanitizedNotification, "type" | "action" | "source">): string | null {
  if (n.action?.kind === "go-to-sequence") return `Go to sequence ${n.action.seq}`;
  return null;
}
