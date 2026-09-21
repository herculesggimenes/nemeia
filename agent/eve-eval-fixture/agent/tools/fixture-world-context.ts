import { defineTool } from "eve/tools";
import { z } from "zod";
import { prepareFixtureContext } from "../fixture-state.ts";

export default defineTool({
  description: "Read the bounded fixture world context for this step.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const context = await prepareFixtureContext(ctx.session.id, ctx.session.turn.id);
    const summary = JSON.parse(context.files.find((file) => file.path === "/world/summary.json")?.content ?? "{}");
    return { contextId: context.contextId, worldRevision: context.worldRevision, value: summary.value };
  },
});
