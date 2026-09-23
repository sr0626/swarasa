// POST /api/activity/tile-click — same-origin relay for the tile-click beacon
// (lib/activity/tileClick.ts). The browser can't read the httpOnly Cognito
// session cookie, so this route handler reads it server-side and forwards the
// click to the backend's registered_user-only `POST /activity/tile-click`
// through the typed client (lib/api/activity.ts).
//
// Always answers 204, whatever happens: the caller is a fire-and-forget
// beacon that can do nothing with an error, and activity tracking must never
// surface as a failure to the visitor. Anyone who isn't a signed-in
// registered_user is silently ignored here (the backend enforces the same
// rule independently — this just avoids a pointless round trip).
import { NextResponse } from "next/server";
import { recordTileClick } from "@/lib/api/activity";
import { getServerSession } from "@/lib/auth/session";
import { parseTileClickBody } from "@/lib/activity/tileClick";

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    if (!session || session.role !== "registered_user") {
      return new NextResponse(null, { status: 204 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new NextResponse(null, { status: 204 });
    }

    const input = parseTileClickBody(body);
    if (input) {
      await recordTileClick(input, session.accessToken);
    }
  } catch {
    // Best-effort by design — see header comment.
  }
  return new NextResponse(null, { status: 204 });
}
