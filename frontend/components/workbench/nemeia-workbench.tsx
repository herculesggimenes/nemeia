"use client";

import { forwardRef, type FunctionComponent, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import {
  type BuiltInContextMenuItem,
  DockviewDefaultTab,
  DockviewReact,
  themeCatppuccinMocha,
  type DockviewApi,
  type GetTabContextMenuItemsParams,
  type IDockviewPanelHeaderProps,
  type DockviewReadyEvent,
  type IDockviewPanelProps
} from "dockview";
import { getPanelDescriptor } from "./workbench-registry";
import type { WorkbenchApi, WorkbenchPanelParams } from "./workbench-types";
import { WorkbenchPanelRenderer } from "./workbench-panel-renderer";
import { WorkbenchActionsContext } from "./workbench-context";

type Props = {
  activeRoute: "conversation" | "settings";
};

const dockviewComponents = {
  workbenchPanel: WorkbenchPanelRenderer
};

const dockviewTabComponents = {
  pinnedWorkbenchTab: PinnedWorkbenchTab
};

const SETTINGS_PANEL_ID = "atena.runtime_config";
const MODULES_PANEL_WIDTH = 136;
const CONVERSATION_PANEL_WIDTH = 560;

function PinnedWorkbenchTab(props: IDockviewPanelHeaderProps) {
  return <DockviewDefaultTab {...props} hideClose />;
}

function getTabContextMenuItems(params: GetTabContextMenuItemsParams): BuiltInContextMenuItem[] {
  if (params.panel.id === "modules") {
    return [];
  }

  return ["close", "closeOthers", "closeAll"];
}

function defaultPositionFor(panelId: string) {
  if (panelId === "modules") {
    return undefined;
  }

  if (panelId === "conversation.main") {
    return { referencePanel: "modules", direction: "right" as const };
  }

  if (panelId === "world.main") {
    return { referencePanel: "conversation.main", direction: "right" as const };
  }

  if (panelId === "go2.front_camera") {
    return { referencePanel: "world.main", direction: "within" as const };
  }

  if (panelId === "go2.point_cloud") {
    return { referencePanel: "world.main", direction: "within" as const };
  }

  if (panelId === "go2.control") {
    return { referencePanel: "conversation.main", direction: "below" as const };
  }

  return { referencePanel: "world.main", direction: "within" as const };
}

function panelParams(panelId: string): WorkbenchPanelParams {
  const descriptor = getPanelDescriptor(panelId);
  return {
    artifactId: descriptor?.artifactId,
    moduleId: descriptor?.moduleId,
    panelId
  };
}

function resizeDefaultPanels(api: DockviewApi) {
  const applySize = () => {
    api.getPanel("modules")?.api.setSize({ width: MODULES_PANEL_WIDTH });
    api.getPanel("conversation.main")?.api.setSize({ width: CONVERSATION_PANEL_WIDTH });
    api.getPanel("go2.control")?.api.setSize({ width: CONVERSATION_PANEL_WIDTH });
  };

  window.requestAnimationFrame(applySize);
  window.setTimeout(applySize, 50);
  window.setTimeout(applySize, 150);
}

export const NemeiaWorkbench = forwardRef<WorkbenchApi, Props>(({ activeRoute }, ref) => {
  const apiRef = useRef<DockviewApi | null>(null);

  const openPanel = useCallback((panelId: string) => {
    const api = apiRef.current;
    const descriptor = getPanelDescriptor(panelId);
    if (!api || !descriptor) {
      return;
    }

    const existing = api.getPanel(panelId);
    if (existing) {
      existing.api.setActive();
      return;
    }

    api.addPanel({
      id: descriptor.id,
      title: descriptor.title,
      component: "workbenchPanel",
      initialWidth:
        descriptor.id === "modules"
          ? MODULES_PANEL_WIDTH
          : descriptor.id === "conversation.main"
            ? CONVERSATION_PANEL_WIDTH
            : undefined,
      params: panelParams(panelId),
      position: defaultPositionFor(panelId),
      tabComponent: descriptor.id === "modules" ? "pinnedWorkbenchTab" : undefined
    });
  }, []);

  const resetLayout = useCallback(() => {
    const api = apiRef.current;
    if (!api) {
      return;
    }

    api.clear();
    for (const panelId of ["modules", "conversation.main", "world.main", "go2.control"]) {
      openPanel(panelId);
    }
    resizeDefaultPanels(api);
  }, [openPanel]);

  const workbenchActions = useMemo(() => ({ openPanel }), [openPanel]);

  useImperativeHandle(ref, () => ({ openPanel, resetLayout }));

  useEffect(() => {
    openPanel(activeRoute === "settings" ? SETTINGS_PANEL_ID : "conversation.main");
  }, [activeRoute, openPanel]);

  const onReady = (event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    // World is the lightweight right-side anchor. Media and point-cloud views
    // mount only when their interactions are selected.
    for (const panelId of ["modules", "conversation.main", "world.main", "go2.control"]) {
      openPanel(panelId);
    }
    resizeDefaultPanels(event.api);
    if (activeRoute === "settings") {
      openPanel(SETTINGS_PANEL_ID);
    }
  };

  return (
    <div className="h-full min-h-0 w-full overflow-hidden dockview-theme-catppuccin-mocha" data-testid="nemeia-workbench">
      <WorkbenchActionsContext.Provider value={workbenchActions}>
        <DockviewReact
          components={dockviewComponents as Record<string, FunctionComponent<IDockviewPanelProps<WorkbenchPanelParams>>>}
          dndStrategy="pointer"
          getTabContextMenuItems={getTabContextMenuItems}
          noPanelsOverlay="emptyGroup"
          onReady={onReady}
          scrollbars="custom"
          tabComponents={dockviewTabComponents}
          theme={themeCatppuccinMocha}
        />
      </WorkbenchActionsContext.Provider>
    </div>
  );
});

NemeiaWorkbench.displayName = "NemeiaWorkbench";
