import { Redirect } from "expo-router";
import SequencesScreen from "@/field/SequencesScreen";
import { useTabletRouteWorkspace } from "@/field/useTabletRouteWorkspace";

/** Tablet-only combined sequence-list and map workspace. */
export default function RouteWorkspacePage() {
  const isTablet = useTabletRouteWorkspace();

  if (!isTablet) return <Redirect href="/(field)/sequences" />;
  return <SequencesScreen combined />;
}
