import { defineAgent } from "eve";

function configuredDeploymentModel(): string {
  const model = process.env.NEMEIA_EVE_MODEL?.trim();
  if (model === undefined || model.length === 0) {
    throw new Error("NEMEIA_EVE_MODEL must name an explicitly qualified deployment model");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(model)) {
    throw new Error("NEMEIA_EVE_MODEL has an invalid deployment model id");
  }
  return model;
}

export default defineAgent({
  // No invented provider id or worker-only model alias is used here. Tests use
  // a deterministic fixture outside Eve's paid provider path.
  model: configuredDeploymentModel(),
  reasoning: "none",
  limits: {
    maxInputTokensPerSession: 200_000,
    maxOutputTokensPerSession: 64_000,
    maxTokenCostUsdPerSession: 1,
  },
});
