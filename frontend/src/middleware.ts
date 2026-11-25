// Passes the requested path to server components, so `requireSession()` can
// send a signed-out visitor back to the page they asked for after sign-in
// (a server component cannot otherwise read the current URL). No auth
// decision is made here.
import { NextResponse, type NextRequest } from "next/server";
import { PATHNAME_HEADER } from "@/lib/auth/safeNext";

export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Always overwritten: a client-supplied value never reaches the page.
  headers.set(PATHNAME_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/admin/:path*", "/portal/:path*", "/account/:path*", "/privacy", "/claim"],
};
