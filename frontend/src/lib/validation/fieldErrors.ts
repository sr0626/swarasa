import type { ZodError } from "zod";

/** First message per top-level field, for rendering field-level form errors. */
export type FieldErrors = Record<string, string>;

export function fieldErrorsFromZod(error: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
