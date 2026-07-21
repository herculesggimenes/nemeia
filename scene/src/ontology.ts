export const DEFAULT_LABEL_MAP = {
  person: "core.person",
  human: "core.person",
  hoodie: "core.garment",
  garment: "core.garment",
  backpack: "core.container",
  obstacle: "core.obstacle"
};

export const DEFAULT_TYPES = {
  "core.person": {
    type: "core.person",
    affordances: ["trackable", "approachable", "followable"],
    physics: { proxy: "capsule", dynamic: true },
    protected: true
  },
  "core.garment": {
    type: "core.garment",
    affordances: ["graspable", "foldable", "deformable"],
    physics: { proxy: "convex_hull", dynamic: true, deformable: true },
    protected: false
  },
  "core.container": {
    type: "core.container",
    affordances: ["trackable", "approachable", "graspable"],
    physics: { proxy: "box", dynamic: true },
    protected: false
  },
  "core.obstacle": {
    type: "core.obstacle",
    affordances: ["obstacle"],
    physics: { proxy: "box", dynamic: false },
    protected: false
  }
};

export const VERB_AFFORDANCE = {
  approach: "approachable",
  follow: "trackable",
  fold: "foldable",
  grasp: "graspable"
};
