export class MockBackpackWorld {
  // Fixture-only helper. It is never used to issue a qualification claim.
  mode = "mock-contract";
  endpoint = "mock://world";
  processRestartCount = 0;
  connected = false;
  identityFingerprint = "mock-scoped-identity";
  resources = new Map();
  observations = new Map();
  mapRevisions = new Map();
  mission = null;
  execution = null;
  finding = null;
  progress = null;

  async start() { this.connected = true; }
  async close() { this.connected = false; }
  async getScopedIdentityFingerprint() { return this.identityFingerprint; }
  async ingestRecordedBackpackFixture({ resourceRef, firstObservation, mapCheckpoint }) {
    const ref = resourceRef;
    this.resources.set(ref.id, ref);
    this.observations.set(firstObservation.id, firstObservation);
    this.mapRevisions.set(mapCheckpoint.id, mapCheckpoint);
  }
  async publishObservation(observation) { this.observations.set(observation.id, observation); }
  async commitMapCheckpoint(checkpoint) { this.mapRevisions.set(checkpoint.id, checkpoint); }
  async readBackpackProjection() {
    return {
      entityIds: [...new Set([...this.observations.values()].map(row => row.entityId))],
      observationIds: [...this.observations.keys()],
      mapRevisionIds: [...this.mapRevisions.keys()],
      resourceIds: [...this.resources.keys()],
      recordedAcquisitionAt: [...this.observations.values()][0]?.recordedAcquisitionAt
    };
  }
  async restartWorldProcess() {
    this.connected = false;
    this.processRestartCount += 1;
    this.connected = true;
  }
  async createMission(mission) { this.mission = mission; return mission; }
  async assignUnit(unit) { this.assignment = unit; return unit; }
  async proposeNavigate(input) { this.execution = { ...input, state: "admitted" }; return this.execution; }
  async claimExecution(executionId) {
    if (!this.execution || this.execution.executionId !== executionId) throw new Error("unknown execution");
    this.execution = { ...this.execution, state: "claimed" };
    return this.execution;
  }
  async completeExecution(executionId) {
    if (!this.execution || this.execution.executionId !== executionId) throw new Error("unknown execution");
    this.execution = { ...this.execution, state: "succeeded", measured: true };
    return this.execution;
  }
  async recordReviewedFinding(finding) { this.finding = { ...finding, reviewedBy: "world-operator-test" }; return this.finding; }
  async recordObjectiveProgress(progress) { this.progress = progress; return progress; }
}
