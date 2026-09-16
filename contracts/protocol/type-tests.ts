// Compile-time rejection cases. These do not replace JSON boundary validation.
import type { Change, Execution, Observation, SpatialGeometry } from "./protocol.js";

// @ts-expect-error a 3D box without dimensions is not valid geometry
const incompleteBox: SpatialGeometry = { kind: "boundingBox3D", frameId: "map", pose: { positionM: [0, 0, 0], orientation: [0, 0, 0, 1] } };
// @ts-expect-error an observation must include at least one measured facet
const emptyObservation: Observation = { id: "obs", inputs: [], retained: [], supersedes: [], transforms: [] };
// @ts-expect-error a power component cannot contain a connection value
const wrongComponent: Change = { op: "component.set", entityId: "robot", key: "core.power", component: { version: 1, value: { state: "online" } } };
// @ts-expect-error success requires a result and a finish time
const incompleteSuccess: Execution = { id: "exec", request: { requestId: "req", action: { name: "approach", version: 1 }, actorId: "robot", input: {} }, executor: { name: "executor", version: "1", sha256: "hash" }, mode: "physical", binding: [], createdAt: "2026-09-15T00:00:00.000Z", state: "succeeded" };

void [incompleteBox, emptyObservation, wrongComponent, incompleteSuccess];
