export const runStory = [
  ["01", "Sense the world", "Cameras, spatial sensors, APIs, and simulations produce observations about what currently exists."],
  ["02", "Create entities", "Each stable thing becomes an entity: a robot, person, backpack, door, room, or purely virtual object."],
  ["03", "Attach components", "Components describe state and ability. Transform says where; locomotion says it can move; portable says it can be carried."],
  ["04", "Derive interactions", "Actions appear when actor and target components match. Locomotion plus a target Transform creates Approach."],
  ["05", "Execute the action", "The selected action is routed to the component that implements it in simulation or on physical hardware."],
  ["06", "Update the world", "Results become component changes, relationships, and events. The next set of interactions is derived from the new state."]
];

export const frameworkPrimitives = [
  ["World", "Current state", "The queryable collection of entities, components, relationships, actions, and events."],
  ["Entity", "One thing", "A stable identity for anything that exists in the physical or simulated world."],
  ["Component", "State and ability", "Composable data such as Transform, Vision, Locomotion, Portable, or Openable."],
  ["Relationship", "Meaning between things", "A directed fact such as sees, inside, near, holding, or connected_to."],
  ["Action", "Meaningful change", "An interaction whose requirements are expressed entirely through components."],
  ["System", "Continuous behavior", "A process that senses, updates components, executes actions, or emits events."]
];

export const productionFeatures = [
  ["Live sensing", "Stream observations into components without coupling the world model to a sensor vendor."],
  ["Pairwise affordances", "Ask what one entity can do to another and get the available interactions now."],
  ["Action runtime", "Execute an interaction and apply its component effects, relationships, and events."],
  ["Simulation parity", "Keep action meaning constant while swapping simulated and physical implementations."],
  ["Portable hardware", "Project every machine into the same components while protocol code stays in adapters."],
  ["Extensible systems", "Add planning, memory, governance, safety, and multi-agent behavior as components."]
];
