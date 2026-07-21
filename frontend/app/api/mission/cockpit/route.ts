import { cockpitProjection } from "../../../../lib/server/mission-cockpit-runtime";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await cockpitProjection());
}
