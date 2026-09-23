// Regression test for the manager (and owner/admin) cover/gallery photo
// upload bug: "Uploading the image failed. Please try again." for every
// caller.
//
// Root cause: `POST /locations/{id}/photos/upload-url` returns a
// presigned S3 **POST** (`upload_url` + `fields`) — a deliberate backend
// contract change (see backend/app/services/s3_service.py's
// `generate_location_photo_upload_url` docstring, docs/API_CONTRACTS.md
// "POST /locations/{id}/photos/upload-url") made when the S3 image
// resize pipeline was completed. The frontend upload helper was written
// (and never updated) against the OLD contract — a plain presigned
// `PUT` of the raw file body straight to `upload_url` — which S3 rejects
// for a presigned-POST URL. Every caller hit this identically; it just
// happened to be reported first by a manager. This test would have
// caught the regression: it fails against the old plain-PUT
// implementation (wrong HTTP method, wrong body shape, missing `fields`)
// and passes against `postFileToS3`/`buildPhotoUploadFormData`.
//
// Run with Node's built-in runner: cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";

import { buildPhotoUploadFormData, postFileToS3, type UploadFetchLike } from "./photoUpload.ts";

function makeFile(): File {
  return new File(["fake-jpeg-bytes"], "cover.jpg", { type: "image/jpeg" });
}

test("buildPhotoUploadFormData includes every presigned field plus the file, file last", () => {
  const fields = {
    key: "raw/locations/456/photos/abc123.jpg",
    "Content-Type": "image/jpeg",
    policy: "base64-policy",
    "x-amz-signature": "sig",
  };
  const file = makeFile();

  const formData = buildPhotoUploadFormData(fields, file);
  const keys = [...formData.keys()];

  // Every presigned field must be present, and "file" must come last —
  // S3 ignores form fields appended after the file part.
  assert.deepEqual(keys, ["key", "Content-Type", "policy", "x-amz-signature", "file"]);
  for (const [k, v] of Object.entries(fields)) {
    assert.equal(formData.get(k), v);
  }
  assert.equal(formData.get("file"), file);
});

test("postFileToS3 POSTs a multipart form to upload_url, never a raw PUT of the file body", async () => {
  const fields = { key: "raw/locations/456/photos/abc123.jpg", "Content-Type": "image/jpeg" };
  const file = makeFile();

  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const fakeFetch: UploadFetchLike = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return { ok: true };
  };

  const ok = await postFileToS3("https://fake-bucket.s3.amazonaws.com/", fields, file, fakeFetch);

  assert.equal(ok, true);
  assert.equal(capturedUrl, "https://fake-bucket.s3.amazonaws.com/");
  // The old, buggy implementation sent `method: "PUT"` with the raw File
  // as the body and a manually-set Content-Type header — none of that
  // matches a presigned-POST S3 target.
  assert.equal(capturedInit?.method, "POST");
  assert.ok(capturedInit?.body instanceof FormData, "body must be a multipart FormData, not the raw file");
  const body = capturedInit?.body as FormData;
  assert.equal(body.get("key"), fields.key);
  assert.equal(body.get("Content-Type"), fields["Content-Type"]);
  assert.equal(body.get("file"), file);
});

test("postFileToS3 returns false (not a thrown error) when S3 responds non-2xx", async () => {
  const fakeFetch: UploadFetchLike = async () => ({ ok: false });
  const ok = await postFileToS3("https://fake-bucket.s3.amazonaws.com/", {}, makeFile(), fakeFetch);
  assert.equal(ok, false);
});

test("postFileToS3 returns false (not a thrown error) on a network failure", async () => {
  const fakeFetch: UploadFetchLike = async () => {
    throw new Error("network down");
  };
  const ok = await postFileToS3("https://fake-bucket.s3.amazonaws.com/", {}, makeFile(), fakeFetch);
  assert.equal(ok, false);
});
