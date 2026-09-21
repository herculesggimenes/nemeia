import assert from "node:assert/strict";
import test from "node:test";
import {
  type CurrentWorldSnapshot,
  type WorldConnectionCallbacks,
  type WorldConnection,
  WorldClient,
} from "../src/index.ts";

type Callback = () => void;

class FakeTable<Row extends object> {
  readonly rows: Row[] = [];
  readonly #inserts = new Set<Callback>();
  readonly #deletes = new Set<Callback>();
  readonly #updates = new Set<Callback>();

  [Symbol.iterator](): Iterator<Row> {
    return this.rows[Symbol.iterator]();
  }

  onInsert(callback: Callback): void { this.#inserts.add(callback); }
  removeOnInsert(callback: Callback): void { this.#inserts.delete(callback); }
  onDelete(callback: Callback): void { this.#deletes.add(callback); }
  removeOnDelete(callback: Callback): void { this.#deletes.delete(callback); }
  onUpdate(callback: Callback): void { this.#updates.add(callback); }
  removeOnUpdate(callback: Callback): void { this.#updates.delete(callback); }

  insert(row: Row): void {
    this.rows.push(row);
    for (const callback of this.#inserts) callback();
  }

  update(row: Row): void {
    this.rows[0] = row;
    for (const callback of this.#updates) callback();
  }
}

type FakeViews = Record<string, FakeTable<Record<string, unknown>>>;

class FakeSubscription {
  #applied: (() => void) | undefined;
  #error: ((context: { event?: Error }) => void) | undefined;
  #ended = false;
  readonly #views: FakeViews;

  constructor(views: FakeViews) {
    this.#views = views;
  }

  onApplied(callback: () => void): this {
    this.#applied = callback;
    return this;
  }

  onError(callback: (context: { event?: Error }) => void): this {
    this.#error = callback;
    return this;
  }

  subscribe(query: (views: FakeViews) => unknown): this {
    query(this.#views);
    return this;
  }

  apply(): void { this.#applied?.(); }
  fail(): void { this.#ended = true; this.#error?.({ event: new Error("subscription_failed") }); }
  unsubscribe(): void { this.#ended = true; }
  isEnded(): boolean { return this.#ended; }
}

function makeFakeConnection(callbacks: WorldConnectionCallbacks): {
  connection: WorldConnection;
  views: FakeViews;
  subscriptions: FakeSubscription[];
} {
  const names = [
    "readiness",
    "addressedMessages",
    "assignedMissions",
    "relevantActionBindings",
    "relevantAgents",
    "relevantEntities",
    "relevantExecutions",
    "relevantFeedbackWatermarks",
    "relevantGeometry",
    "relevantLocalMaps",
    "relevantMissionAgents",
    "relevantMissionObjectiveProgress",
    "relevantPoses",
    "relevantSemantic",
    "relevantUnitAssignments",
    "relevantUnitControls",
  ];
  const views = Object.fromEntries(names.map((name) => [name, new FakeTable<Record<string, unknown>>()])) as FakeViews;
  const subscriptions: FakeSubscription[] = [];
  const connection = {
    isActive: true,
    isDisconnectRequested: false,
    db: views,
    subscriptionBuilder: () => ({
      onApplied: (callback: () => void) => {
        const subscription = new FakeSubscription(views);
        subscriptions.push(subscription);
        subscription.onApplied(callback);
        return subscription;
      },
    }),
    disconnect: () => {
      connection.isActive = false;
      connection.isDisconnectRequested = true;
      callbacks.onDisconnect();
    },
  } as unknown as WorldConnection;
  callbacks.onConnect(connection);
  return { connection, views, subscriptions };
}

function options(factory: (callbacks: WorldConnectionCallbacks) => WorldConnection) {
  return {
    uri: "ws://127.0.0.1:3000",
    databaseName: "test",
    connectionFactory: factory,
  };
}

function authorize(views: FakeViews, authorized = true): void {
  views.readiness.insert({
    key: "world",
    worldId: "world",
    mode: "simulation",
    authorized,
    role: authorized ? "world_operator" : "anonymous",
    unitId: undefined,
    synchronized: authorized,
  });
}

test("ready waits for all views, snapshots are detached, and row changes coalesce", async () => {
  let harness: ReturnType<typeof makeFakeConnection> | undefined;
  let notifications = 0;
  let lastSnapshot: CurrentWorldSnapshot | undefined;
  const client = new WorldClient({
    ...options((callbacks) => {
      harness = makeFakeConnection(callbacks);
      return harness.connection;
    }),
    onSnapshotChange: (snapshot) => {
      notifications += 1;
      lastSnapshot = snapshot;
    },
  });

  client.connect();
  assert.equal(client.state, "connecting");
  assert.throws(() => client.snapshot(), /not_ready/);
  assert.ok(harness);
  authorize(harness.views);
  const subscription = client.subscribeCurrentWorld();
  assert.equal(client.state, "connecting");
  harness.subscriptions[0].apply();
  assert.equal(client.state, "ready");
  const row = { id: "entity-1", displayName: "one", kind: "unit", removedAt: undefined };
  harness.views.relevantEntities.insert(row);
  harness.views.relevantEntities.update({ ...row, displayName: "two" });
  const missionRow = {
    id: "mission-1",
    owner: "identity",
    spec: {
      description: "mission",
      template: undefined,
      objectives: [{ id: "objective-1", description: "original", dependsOn: [], optional: false, criterion: { tag: "located", value: { description: "here" } } }],
      deadlineAt: undefined,
    },
    state: { tag: "active" },
    revision: 1n,
    closingOutcome: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  harness.views.assignedMissions.insert(missionRow);
  await Promise.resolve();
  assert.equal(notifications, 1);
  assert.equal(lastSnapshot?.relevantEntities[0]?.displayName, "two");
  const detached = client.snapshot();
  detached.relevantEntities[0].displayName = "mutated-local-copy";
  detached.assignedMissions[0].spec.objectives[0].description = "mutated-nested-copy";
  assert.equal(harness.views.relevantEntities.rows[0].displayName, "two");
  const cachedMission = harness.views.assignedMissions.rows[0] as unknown as {
    spec: { objectives: Array<{ description: string }> };
  };
  assert.equal(cachedMission.spec.objectives[0].description, "original");
});

test("subscription error invalidates readiness and reconnect resubscribes", () => {
  const harnesses: Array<ReturnType<typeof makeFakeConnection>> = [];
  const client = new WorldClient(options((callbacks) => {
    const harness = makeFakeConnection(callbacks);
    harnesses.push(harness);
    return harness.connection;
  }));

  client.connect();
  authorize(harnesses[0].views);
  client.subscribeCurrentWorld();
  harnesses[0].subscriptions[0].apply();
  assert.equal(client.state, "ready");
  harnesses[0].subscriptions[0].fail();
  assert.equal(client.state, "error");
  assert.throws(() => client.snapshot(), /not_ready/);

  client.connect();
  assert.equal(harnesses.length, 1);
  authorize(harnesses[0].views);
  assert.equal(harnesses[0].subscriptions.length, 2);
  harnesses[0].subscriptions[1].apply();
  assert.equal(client.state, "ready");
});

test("authorization denial does not become ready", () => {
  let harness: ReturnType<typeof makeFakeConnection> | undefined;
  const client = new WorldClient(options((callbacks) => {
    harness = makeFakeConnection(callbacks);
    return harness.connection;
  }));
  client.connect();
  assert.ok(harness);
  authorize(harness.views, false);
  const subscription = client.subscribeCurrentWorld();
  harness.subscriptions[0].apply();
  assert.equal(client.state, "error");
  assert.throws(() => client.snapshot(), /not_ready/);
});

test("disconnect invalidates readiness and a new connection reapplies the feed", () => {
  const harnesses: Array<ReturnType<typeof makeFakeConnection>> = [];
  const client = new WorldClient(options((callbacks) => {
    const harness = makeFakeConnection(callbacks);
    harnesses.push(harness);
    return harness.connection;
  }));

  client.connect();
  authorize(harnesses[0].views);
  client.subscribeCurrentWorld();
  harnesses[0].subscriptions[0].apply();
  assert.equal(client.state, "ready");
  harnesses[0].connection.disconnect();
  assert.equal(client.state, "disconnected");
  assert.throws(() => client.snapshot(), /not_ready/);

  client.connect();
  assert.equal(harnesses.length, 2);
  authorize(harnesses[1].views);
  assert.equal(harnesses[1].subscriptions.length, 1);
  harnesses[1].subscriptions[0].apply();
  assert.equal(client.state, "ready");
});
