import { stopCockpitRobot } from "../../../../../../../lib/server/mission-cockpit-runtime";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ robotId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { robotId } = await context.params;
  if (robotId !== "robot_01") {
    return Response.json({
      error_code: "ROBOT_NOT_FOUND",
      message: `Robot ${robotId} is not registered in the cockpit projection.`
    }, { status: 404 });
  }
  const body = await request.json().catch(() => ({})) as { reason?: string };
  return Response.json(await stopCockpitRobot({ reason: body.reason }));
}
