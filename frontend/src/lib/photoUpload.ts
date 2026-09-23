// Presigned-S3-POST upload helper for the location cover/gallery photo
// flow — pulled out of components/portal/LocationPhotoManager.tsx so the
// upload mechanics are unit-testable in isolation (same DI pattern as
// lib/geocode/geocoder.ts's `FetchLike`), and so nothing else that needs
// this same presigned-POST shape (e.g. a future manager-portal upload
// surface) has to reimplement it.
//
// `POST /locations/{id}/photos/upload-url` (docs/API_CONTRACTS.md, same
// section) returns a presigned S3 **POST** — `upload_url` + `fields` —
// not a presigned PUT. That's a deliberate backend choice (S3's
// `content-length-range` condition, needed for BRD 5.3's 5MB cap, only
// exists for presigned POST policies; see
// backend/app/services/s3_service.py's `generate_location_photo_upload_url`
// docstring). The upload must be a multipart form POST: every entry in
// `fields` as its own form field, then the file itself last under the
// field name `file` (S3 ignores form fields that appear after the file
// part) — never a raw `PUT` of the file body.
export type UploadFetchLike = (
  input: string,
  init: RequestInit
) => Promise<{ ok: boolean }>;

/** Builds the exact multipart body S3's presigned-POST endpoint expects. */
export function buildPhotoUploadFormData(
  fields: Record<string, string>,
  file: File
): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  // Must be appended last — S3 ignores form fields added after `file`.
  formData.append("file", file);
  return formData;
}

/**
 * Uploads `file` directly to S3 via a presigned POST. Returns `false`
 * (never throws) on any non-2xx response or network failure, so callers
 * can show a friendly "upload failed" message without needing their own
 * try/catch.
 */
export async function postFileToS3(
  uploadUrl: string,
  fields: Record<string, string>,
  file: File,
  fetchFn: UploadFetchLike = fetch
): Promise<boolean> {
  try {
    const res = await fetchFn(uploadUrl, {
      method: "POST",
      body: buildPhotoUploadFormData(fields, file),
    });
    return res.ok;
  } catch {
    return false;
  }
}
