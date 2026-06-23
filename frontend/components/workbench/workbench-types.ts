import type { Artifact } from "../../types/nemeia";

export type ModuleKind =
  | "agent.llm"
  | "audio.speaker"
  | "robot.dog"
  | "runtime"
  | "sensor.camera"
  | "sensor.lidar";

export type WorkbenchPanelKind =
  | "audio"
  | "camera"
  | "config"
  | "control"
  | "conversation"
  | "generated_artifact"
  | "modules"
  | "point_cloud"
  | "settings"
  | "stats";

export type ModulePanelDescriptor = {
  id: string;
  kind: WorkbenchPanelKind;
  title: string;
  artifactId?: Artifact["id"];
  defaultPlacement: "bottom" | "center" | "left" | "right";
  moduleId?: string;
  singleton?: boolean;
};

export type ModuleInstance = {
  id: string;
  kind: ModuleKind;
  label: string;
  panelIds: string[];
  parentId?: string;
  provider: string;
};

export type WorkbenchPanelParams = {
  artifactId?: Artifact["id"];
  moduleId?: string;
  panelId: string;
};

export type WorkbenchApi = {
  openPanel: (panelId: string) => void;
  resetLayout: () => void;
};
