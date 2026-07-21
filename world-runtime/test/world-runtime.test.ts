import assert from "node:assert/strict";
import test from "node:test";
import { WorldRuntimeError } from "../src/world-runtime-errors.ts";
import { WorldRuntime } from "../src/world-runtime.ts";

function createWorld() {
  const world = new WorldRuntime({ clock: () => new Date("2026-07-21T12:00:00.000Z") });
  world.upsertEntity({
    id: "robot_01",
    label: "Robot",
    type: "core.robot",
    components: { locomotion: { state: "ready" }, perception: { camera: true }, transform: { x: 0, y: 0 } }
  });
  world.upsertEntity({
    id: "backpack_01",
    label: "Red backpack",
    type: "core.container",
    components: { observable: { confidence: 0.91 }, portable: { mass_kg: 2.1 }, transform: { x: 1.8, y: -0.4 } }
  });
  return world;
}

test("WorldRuntime stores entities as component containers and relationships as first-class state", () => {
  const world = createWorld();
  world.relate({ subject_id: "robot_01", predicate: "sees", object_id: "backpack_01", components: { confidence: 0.91 } });

  assert.equal(world.entities().length, 2);
  assert.deepEqual(world.entity("robot_01")?.components.transform, { x: 0, y: 0 });
  assert.deepEqual(world.relationships(), [{ subject_id: "robot_01", predicate: "sees", object_id: "backpack_01", components: { confidence: 0.91 } }]);
  assert.equal(world.events().at(-1)?.type, "relationship.updated");
});

test("WorldRuntime derives pairwise affordances from actor and target components", () => {
  const world = createWorld();
  world.registerAction({
    id: "approach",
    label: "Approach",
    description: "Move near a target.",
    actor_components: ["locomotion", "transform"],
    target_components: ["transform"],
    available: ({ actor }) => (actor.components.locomotion as { state: string }).state === "ready" || "Locomotion is not ready",
    perform: () => ({ result: { accepted: true } })
  });

  const affordance = world.affordancesFor("robot_01", "backpack_01")[0];
  assert.deepEqual(affordance, {
    action_id: "approach",
    actor_id: "robot_01",
    target_id: "backpack_01",
    available: true,
    description: "Move near a target.",
    label: "Approach",
    reason: null
  });

  world.upsertEntity({ id: "robot_01", label: "Robot", type: "core.robot", components: { locomotion: { state: "offline" } } });
  assert.equal(world.affordancesFor("robot_01", "backpack_01")[0].reason, "Locomotion is not ready");
});

test("WorldRuntime executes an available action and applies effects, relations, and events", async () => {
  const world = createWorld();
  world.registerAction({
    id: "inspect",
    label: "Inspect",
    description: "Observe a target in detail.",
    actor_components: ["perception"],
    target_components: ["observable"],
    perform: ({ actor, target }) => ({
      effects: [{ entity_id: target!.id, components: { inspected: { by: actor.id } } }],
      relationships: [{ subject_id: actor.id, predicate: "inspected", object_id: target!.id, components: {} }],
      events: [{ type: "perception.inspection", entity_ids: [target!.id], data: { confidence: 0.91 } }],
      result: { target_id: target!.id, confidence: 0.91 }
    })
  });

  const result = await world.execute({ action_id: "inspect", actor_id: "robot_01", target_id: "backpack_01" });

  assert.deepEqual(result, { target_id: "backpack_01", confidence: 0.91 });
  assert.deepEqual(world.entity("backpack_01")?.components.inspected, { by: "robot_01" });
  assert.equal(world.relationships()[0].predicate, "inspected");
  assert.deepEqual(world.events().slice(-5).map((event) => event.type), ["action.started", "entity.updated", "relationship.updated", "perception.inspection", "action.completed"]);
});

test("WorldRuntime rejects actions whose component requirements are not met", async () => {
  const world = createWorld();
  world.registerAction({
    id: "pick_up",
    label: "Pick up",
    description: "Lift a portable target.",
    actor_components: ["manipulator"],
    target_components: ["portable"],
    perform: () => ({})
  });

  await assert.rejects(
    world.execute({ action_id: "pick_up", actor_id: "robot_01", target_id: "backpack_01" }),
    (error) => error instanceof WorldRuntimeError && error.code === "ACTION_NOT_AVAILABLE" && error.message.includes("manipulator")
  );
});

test("WorldRuntime snapshots are detached and deterministic", () => {
  const world = createWorld();
  const snapshot = world.snapshot();

  assert.deepEqual(snapshot.entities.map((entity) => entity.id), ["backpack_01", "robot_01"]);
  assert.equal(snapshot.last_event_seq, 2);
  assert.throws(() => { (snapshot.entities as unknown[]).push({}); }, TypeError);
});
