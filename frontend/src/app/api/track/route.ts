// POST /api/track — same-origin relay for the public engagement beacons
// (lib/analytics/track.ts). The browser can't read the httpOnly session
// cookie, so this route reads it server-side and forwards the event to the
// backend's public `POST /track/location/{id}` WITH the token when there is
// one: the backend uses it only to drop a signed-in owner's / assigned
// manager's / admin's own views of their location (the authoritative check).
// Admins are also skipped here to save a round trip.
//
// Always answers 204, whatever happens: the caller is a fire-and-forget
// beacon, and analytics must never surface as a failure to a visitor.
import { NextResponse } from "next/server";
import { recordLocationEvent } from "@/lib/api/analytics";
import { getServerSession } from "@/lib/auth/session";
import { parseTrackBody } from "@/lib/analytics/track";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new NextResponse(null, { status: 204 });
    }
    const input = parseTrackBody(body);
    if (!input) return new NextResponse(null, { status: 204 });

    let accessToken: string | null = null;
    try {
      const session = await getServerSession();
      if (session?.role === "admin") return new NextResponse(null, { status: 204 });
      accessToken = session?.accessToken ?? null;
    } catch {
      // No usable session: count as an anonymous view.
    }
    await recordLocationEvent(input.location_id, input.event, accessToken);
  } catch {
    // Best-effort by design — see header comment.
  }
  return new NextResponse(null, { status: 204 });
}
