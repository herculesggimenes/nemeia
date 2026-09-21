import assert from "node:assert/strict";
import test from "node:test";
import { TypesafeAdapter } from "../lib/typesafe-adapter.ts";

test("recorded TypeSafe Choice and Score answers preserve distributions", async () => {
  const requests = [];
  const adapter = new TypesafeAdapter({
    async evaluate(request) {
      requests.push(request);
      const question = request.questions[0];
      if (question.type === "choice") {
        return { answers: { [question.id]: { choice: "none", probabilities: { candidate: 0.1, none: 0.9 }, confidence: 0.9 } } };
      }
      return { answers: { [question.id]: { score: 1.5, legend: ["low", "medium", "high"], probabilities: [0.1, 0.8, 0.1], confidence: 0.8 } } };
    },
  });
  const choice = await adapter.evaluate({ text: "record" }, {
    id: "classification",
    type: "choice",
    instructions: "candidate or none?",
    criteria: { candidate: "candidate", none: "none" },
  });
  const score = await adapter.evaluate({ text: "record" }, {
    id: "severity",
    type: "score",
    instructions: "how severe?",
    criteria: ["low", "medium", "high"],
  });
  assert.equal(choice.kind, "choice");
  assert.deepEqual(choice.answer.probabilities, { candidate: 0.1, none: 0.9 });
  assert.equal(score.kind, "score");
  assert.deepEqual(score.answer.probabilities, [0.1, 0.8, 0.1]);
  assert.deepEqual(requests.map((request) => request.model), ["jev-1.13.0", "jev-1.13.0"]);
});

test("recorded Noul applies conservative yes/no thresholds", async () => {
  let answer = 0.51;
  const adapter = new TypesafeAdapter({
    async evaluate(request) {
      return { answers: { [request.questions[0].id]: { noul: answer } } };
    },
  });
  assert.equal((await adapter.evaluate({}, { id: "is", type: "noul", instructions: "is it?" })).kind, "abstain");
  answer = 0.9;
  const yes = await adapter.evaluate({}, { id: "is", type: "noul", instructions: "is it?" });
  assert.equal(yes.kind, "noul");
  assert.equal(yes.yes, true);
  answer = 0.1;
  const no = await adapter.evaluate({}, { id: "is", type: "noul", instructions: "is it?" });
  assert.equal(no.kind, "noul");
  assert.equal(no.yes, false);
});

test("malformed and timeout provider responses abstain without paid inference", async () => {
  const malformed = new TypesafeAdapter({ async evaluate() { return { answers: { q: { choice: "x" } } }; } });
  assert.deepEqual(
    await malformed.evaluate({}, { id: "q", type: "choice", instructions: "choose", criteria: { x: "x" } }),
    { kind: "abstain", reason: "malformed" },
  );
  const timeout = new TypesafeAdapter({
    async evaluate() {
      const error = new Error("fixture timeout");
      error.name = "TimeoutError";
      throw error;
    },
  });
  assert.deepEqual(
    await timeout.evaluate({}, { id: "q", type: "noul", instructions: "is it?" }),
    { kind: "abstain", reason: "timeout" },
  );
});
