import { decideCockpitRun } from "../../../../../../../lib/server/mission-cockpit-runtime";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { runId } = await context.params;
  const body = await request.json().catch(() => ({})) as { decision?: string; reason?: string };
  if (body.decision !== "approve" && body.decision !== "reject") {
    return Response.json({
      error_code: "INVALID_DECISION",
      message: "Decision must be approve or reject."
    }, { status: 400 });
  }

  return Response.json(await decideCockpitRun({
    decision: body.decision,
    reason: body.reason,
    runId
  }));
}
