import { createContext, useContext } from "react";

export type WorkbenchActions = {
  openPanel: (panelId: string) => void;
};

export const WorkbenchActionsContext = createContext<WorkbenchActions>({
  openPanel: () => undefined
});

export function useWorkbenchActions() {
  return useContext(WorkbenchActionsContext);
}
