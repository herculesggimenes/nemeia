const DEFAULT_ATTENTION_TEMPLATE = {
  state_filter: ["run.own"],
  wake_predicate_cel: "event.severity >= WARNING",
  budget: { max_pending: 50 },
  digest_version: 1,
  predicate_env_version: 1
};

export function contractFromPreset({ mission, principal }) {
  const template = typeof mission?.preset === "object" && mission.preset ? mission.preset.attention : null;
  return {
    mission_id: mission.id,
    principal,
    state_filter: [...(template?.state_filter ?? DEFAULT_ATTENTION_TEMPLATE.state_filter)],
    wake_predicate_cel: template?.wake_predicate_cel ?? DEFAULT_ATTENTION_TEMPLATE.wake_predicate_cel,
    budget: {
      max_pending: template?.budget?.max_pending ?? DEFAULT_ATTENTION_TEMPLATE.budget.max_pending
    },
    digest_version: template?.digest_version ?? DEFAULT_ATTENTION_TEMPLATE.digest_version,
    predicate_env_version: template?.predicate_env_version ?? DEFAULT_ATTENTION_TEMPLATE.predicate_env_version
  };
}
