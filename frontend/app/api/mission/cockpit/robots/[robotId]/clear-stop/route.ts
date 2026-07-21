import { clearCockpitRobotStop } from "../../../../../../../lib/server/mission-cockpit-runtime";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ robotId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { robotId } = await context.params;
  if (robotId !== "robot_01") {
    return Response.json({
      error_code: "ROBOT_NOT_FOUND",
      message: `Robot ${robotId} is not registered in the cockpit projection.`
    }, { status: 404 });
  }

  return Response.json(await clearCockpitRobotStop());
}
