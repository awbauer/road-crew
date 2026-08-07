import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ViewStyle } from "react-native";
import { formatRelative, type AppStatus } from "@road-crew/core";
import { ModalShell } from "@/ui/ModalShell";
import { ModalHeader } from "@/ui/ModalHeader";
import { StatusPanel } from "./StatusPanel.tsx";
import { WhereAmIPanel } from "./WhereAmIPanel.tsx";
import { useWhereAmI } from "./useWhereAmI.ts";
import { statusPillStyle, useStatusState, type StatusState } from "./useStatusState.ts";

export { statusColorFor, statusPillStyle } from "./useStatusState.ts";
export type { StatusState } from "./useStatusState.ts";

/** Which half of the popover is showing. */
type SheetView = "location" | "status";

interface StatusSheetContextValue {
  /** Opens on "Where am I?" — the driver question. */
  open: () => void;
  /** Opens straight onto app status and settings, skipping the header toggle. */
  openSettings: () => void;
  status: AppStatus;
  statusColor: string;
  /** Background/outline for the header status pill — see `statusPillStyle`. */
  pillStyle: ViewStyle;
}

/**
 * The field shell's single popover. It opens on "Where am I?" — the driver
 * question — and the badge in its header flips to the app diagnostics that used
 * to be the whole sheet. Diagnostics are for the rare "is this thing working"
 * moment, so they sit one tap behind rather than in front of the driver.
 *
 * Which half shows is owned by the provider, not by this component. It stays
 * mounted for the life of the shell, so a local `debug` flag would persist
 * after close and hand the next caller whichever half the last one left behind
 * — "Where am I?" would open on diagnostics for the rest of the session.
 */
function LocationModal({
  visible,
  onClose,
  statusState,
  sheetView,
  onSheetViewChange,
}: {
  visible: boolean;
  onClose: () => void;
  statusState: StatusState;
  sheetView: SheetView;
  onSheetViewChange: (next: SheetView) => void;
}) {
  const debug = sheetView === "status";
  const { view, gpsError } = useWhereAmI(visible && !debug);
  const toggleDebug = useCallback(
    () => onSheetViewChange(debug ? "location" : "status"),
    [debug, onSheetViewChange],
  );

  return (
    <ModalShell visible={visible} onClose={onClose}>
      {debug ? (
        <ModalHeader
          kicker="STATUS"
          title={statusState.status.label}
          titleColor={statusState.statusColor}
          onClose={onClose}
          icon="screwdriver-wrench"
          iconColor={statusState.statusColor}
          onIconPress={toggleDebug}
          iconAccessibilityLabel="Back to Where am I?"
        />
      ) : (
        <ModalHeader
          title="WHERE AM I?"
          onClose={onClose}
          icon="compass"
          onIconPress={toggleDebug}
          iconAccessibilityLabel="Show app status and diagnostics"
          meta={view ? `LAST UPDATED: ${formatRelative(view.timestampMs)}` : null}
        />
      )}
      {debug ? (
        <StatusPanel visible={visible} onClose={onClose} statusState={statusState} />
      ) : (
        <WhereAmIPanel view={view} gpsError={gpsError} />
      )}
    </ModalShell>
  );
}

const StatusSheetContext = createContext<StatusSheetContextValue | null>(null);

/** Provides a single location/status popover for the field tabs (no URL change). */
export function StatusSheetProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [sheetView, setSheetView] = useState<SheetView>("location");
  const statusState = useStatusState();
  // Every entry point states the half it wants, so none of them can inherit the
  // half a previous caller left showing.
  const open = useCallback(() => {
    setSheetView("location");
    setVisible(true);
  }, []);
  const openSettings = useCallback(() => {
    setSheetView("status");
    setVisible(true);
  }, []);
  const close = useCallback(() => setVisible(false), []);
  const value = useMemo<StatusSheetContextValue>(() => ({
    open,
    openSettings,
    status: statusState.status,
    statusColor: statusState.statusColor,
    pillStyle: statusPillStyle(statusState.status),
  }), [
    open,
    openSettings,
    statusState.status.label,
    statusState.status.level,
    statusState.statusColor,
  ]);
  return (
    <StatusSheetContext.Provider value={value}>
      {children}
      <LocationModal
        visible={visible}
        onClose={close}
        statusState={statusState}
        sheetView={sheetView}
        onSheetViewChange={setSheetView}
      />
    </StatusSheetContext.Provider>
  );
}

export function useStatusSheet(): StatusSheetContextValue {
  const value = useContext(StatusSheetContext);
  if (!value) throw new Error("useStatusSheet must be used within a StatusSheetProvider.");
  return value;
}
