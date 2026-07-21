import { resetCockpitRuntime } from "../../../../../lib/server/mission-cockpit-runtime";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ message: "Cockpit reset is only available outside production." }, { status: 404 });
  }

  resetCockpitRuntime();
  return Response.json({ ok: true });
}
