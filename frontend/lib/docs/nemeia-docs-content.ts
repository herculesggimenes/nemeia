export const docsSections = [
  { label: "Get started", items: [
    { href: "#overview", label: "Overview" },
    { href: "#first-principle", label: "The mental model" },
    { href: "#life-of-a-run", label: "The world loop" }
  ] },
  { label: "Understand Nemeia", items: [
    { href: "#architecture", label: "Architecture" },
    { href: "#core-objects", label: "Core objects" },
    { href: "#trust-model", label: "Composition model" }
  ] },
  { label: "Build", items: [
    { href: "#interfaces", label: "Core interfaces" },
    { href: "#drivers", label: "Drivers" },
    { href: "#capabilities", label: "Capabilities" },
    { href: "#clients", label: "Clients and CLI" }
  ] },
  { label: "Operate", items: [
    { href: "#current-status", label: "Implementation status" },
    { href: "#conformance", label: "Testing" },
    { href: "#reference", label: "Reference" }
  ] }
];

export const coreObjects = [
  ["World", "What exists right now?"],
  ["Entity", "Which thing are we talking about?"],
  ["Component", "What state or ability does it have?"],
  ["Relationship", "How are two entities connected?"],
  ["Affordance", "What interaction is available now?"],
  ["Action", "What meaningful change should occur?"],
  ["System", "What continuously updates the world?"],
  ["Event", "What changed?"]
];

export const nemInterfaces = [
  ["01", "upsertEntity", "Create an entity or merge new component state into it"],
  ["02", "relate", "Create or update a directed relationship between two entities"],
  ["03", "registerAction", "Declare actor and target component requirements plus an implementation"],
  ["04", "affordancesFor", "Derive the actions currently available between an actor and target"],
  ["05", "execute", "Run an available action and apply its effects, relations, and events"],
  ["06", "snapshot", "Read deterministic world state for clients, simulations, or persistence"],
  ["07", "events", "Consume the ordered stream of world changes"]
];

export const runLifecycle = [
  ["Sense", "A sensor, simulation, or API produces an observation."],
  ["Identify", "The observation creates or updates a stable entity."],
  ["Compose", "Components describe the entity's current state and abilities."],
  ["Derive", "Matching components reveal possible actions between entities."],
  ["Act", "The selected interaction runs through its component implementation."],
  ["Update", "Effects, relationships, and events become the next world state."]
];

export const implementationStatus = [
  ["World Runtime", "Implemented", "Entities, components, relationships, action registration, affordance derivation, effects, and events"],
  ["Robot projection", "Implemented", "Connection, locomotion, sensing, audio, power, and pose become standard components"],
  ["Operator World panel", "Implemented", "Live entity inspection and component-derived interactions"],
  ["Semantic perception bridge", "Pending", "Detected objects still need to stream from camera and spatial sensing into stable entities"],
  ["Physical action packs", "Pending", "Component actions need read-only and supervised hardware integration tests"],
  ["Governance extension", "Archived", "The previous Mission and Authorization stack remains available as an optional future package"]
];
