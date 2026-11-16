// POST /api/form-token — same-origin relay that fetches a signed form token
// from the backend (POST /forms/token) and forwards the visitor's address in
// `X-Visitor-IP` (the backend only sees Amplify's). Called by the browser the
// first time a visitor touches a guarded form (lib/formGuard/useFormGuard.ts),
// never on page render, so merely loading a page costs the backend nothing.
//
// Never cached. On any failure answers a bare 503: the form still renders and
// submits; the backend (when enforcing) then answers its generic "please try
// again", which the UI shows with a fresh token fetch.
import { NextResponse } from "next/server";
import { issueFormToken } from "@/lib/api/forms";
import { guardHeadersFor } from "@/lib/formGuard/server";
import { isFormName } from "@/lib/formGuard/guardLogic";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  let form: unknown;
  try {
    form = ((await request.json()) as { form?: unknown } | null)?.form;
  } catch {
    return NextResponse.json({}, { status: 400, headers: NO_STORE });
  }
  if (!isFormName(form)) {
    return NextResponse.json({}, { status: 400, headers: NO_STORE });
  }
  try {
    const issued = await issueFormToken(form, guardHeadersFor(null));
    if (!issued) return NextResponse.json({}, { status: 503, headers: NO_STORE });
    return NextResponse.json(
      { token: issued.token, min_seconds: issued.minSeconds },
      { headers: NO_STORE }
    );
  } catch {
    return NextResponse.json({}, { status: 503, headers: NO_STORE });
  }
}
