import type { ModuleInstance, ModulePanelDescriptor } from "./workbench-types";

export const modulePanels: ModulePanelDescriptor[] = [
  {
    id: "modules",
    kind: "modules",
    title: "Modules",
    defaultPlacement: "left",
    singleton: true
  },
  {
    id: "conversation.main",
    kind: "conversation",
    title: "Conversation",
    defaultPlacement: "center",
    singleton: true
  },
  {
    id: "world.main",
    kind: "world",
    title: "World",
    defaultPlacement: "right",
    moduleId: "world",
    singleton: true
  },
  {
    id: "atena.runtime_config",
    kind: "settings",
    title: "Runtime Config",
    defaultPlacement: "right",
    moduleId: "atena",
    singleton: true
  },
  {
    id: "mission.cockpit",
    kind: "mission",
    title: "Mission Cockpit",
    defaultPlacement: "right",
    moduleId: "atena",
    singleton: true
  },
  {
    id: "go2.front_camera",
    kind: "camera",
    title: "Front Camera",
    artifactId: "camera_front",
    defaultPlacement: "right",
    moduleId: "go2.front_camera",
    singleton: true
  },
  {
    id: "go2.point_cloud",
    kind: "point_cloud",
    title: "Point Cloud",
    artifactId: "point_cloud",
    defaultPlacement: "right",
    moduleId: "go2.lidar",
    singleton: true
  },
  {
    id: "go2.control",
    kind: "control",
    title: "Robot Control",
    artifactId: "control_config",
    defaultPlacement: "bottom",
    moduleId: "go2.control",
    singleton: true
  },
  {
    id: "go2.speaker",
    kind: "audio",
    title: "Speaker",
    artifactId: "speaker",
    defaultPlacement: "right",
    moduleId: "go2.speaker",
    singleton: true
  },
  {
    id: "go2.stats",
    kind: "stats",
    title: "Stats",
    defaultPlacement: "right",
    moduleId: "go2",
    singleton: true
  },
  {
    id: "go2.config",
    kind: "config",
    title: "Robot Config",
    artifactId: "go2_config",
    defaultPlacement: "right",
    moduleId: "go2",
    singleton: true
  },
  {
    id: "go2.front_camera.config",
    kind: "config",
    title: "Front Camera Config",
    artifactId: "camera_front_config",
    defaultPlacement: "right",
    moduleId: "go2.front_camera",
    singleton: true
  },
  {
    id: "go2.lidar.config",
    kind: "config",
    title: "LiDAR Config",
    artifactId: "lidar_config",
    defaultPlacement: "right",
    moduleId: "go2.lidar",
    singleton: true
  },
  {
    id: "go2.control.config",
    kind: "config",
    title: "Control Config",
    artifactId: "control_config",
    defaultPlacement: "right",
    moduleId: "go2.control",
    singleton: true
  },
  {
    id: "go2.speaker.config",
    kind: "config",
    title: "Speaker Config",
    artifactId: "speaker_config",
    defaultPlacement: "right",
    moduleId: "go2.speaker",
    singleton: true
  },
  {
    id: "generated.route_note",
    kind: "generated_artifact",
    title: "Route Note",
    artifactId: "agent_artifact",
    defaultPlacement: "right",
    moduleId: "runtime.agent",
    singleton: true
  },
  {
    id: "module.add",
    kind: "config",
    title: "Add Module",
    artifactId: "add_component",
    defaultPlacement: "right",
    moduleId: "runtime.modules",
    singleton: true
  }
];

export const modules: ModuleInstance[] = [
  {
    id: "atena",
    kind: "agent.llm",
    label: "Atena",
    provider: "nemeia.agent",
    panelIds: ["conversation.main", "mission.cockpit", "atena.runtime_config", "generated.route_note"]
  },
  {
    id: "go2",
    kind: "robot.dog",
    label: "Robot",
    provider: "unitree.go2",
    panelIds: ["go2.config", "go2.front_camera", "go2.point_cloud", "go2.control", "go2.speaker", "go2.stats"]
  },
  {
    id: "go2.front_camera",
    kind: "sensor.camera",
    label: "Front camera",
    parentId: "go2",
    provider: "unitree.go2",
    panelIds: ["go2.front_camera", "go2.front_camera.config"]
  },
  {
    id: "go2.lidar",
    kind: "sensor.lidar",
    label: "LiDAR / SLAM",
    parentId: "go2",
    provider: "unitree.go2",
    panelIds: ["go2.point_cloud", "go2.lidar.config"]
  },
  {
    id: "go2.control",
    kind: "robot.dog",
    label: "Control",
    parentId: "go2",
    provider: "unitree.go2",
    panelIds: ["go2.control", "go2.control.config"]
  },
  {
    id: "go2.speaker",
    kind: "audio.speaker",
    label: "Speaker",
    parentId: "go2",
    provider: "unitree.go2",
    panelIds: ["go2.speaker", "go2.speaker.config"]
  }
];

export function getPanelDescriptor(panelId: string) {
  return modulePanels.find((panel) => panel.id === panelId) ?? null;
}
