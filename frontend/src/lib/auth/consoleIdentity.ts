// Best-effort identity for the role-console banner (name, email, role):
// GET /auth/me, falling back to the session's own claims when it fails so a
// failed lookup never takes a console page down. Shared by the admin layout,
// the owner dashboard and the brands layout.
import { getCurrentUser } from "@/lib/api/auth";
import type { AuthMe, Session } from "@/types/auth";

export async function loadConsoleIdentity(session: Session): Promise<AuthMe> {
  try {
    return await getCurrentUser(session.accessToken);
  } catch {
    return {
      cognito_sub: session.cognitoSub,
      role: session.role,
      email: session.email,
      owner_account: null,
    };
  }
}
