"use client";

// Photo gallery management — the presigned S3 upload pattern from
// frontend/src/lib/api/locations.ts (getLocationPhotoUploadUrl -> multipart
// POST to S3 directly -> createLocationPhoto), wired to a real file input
// for the first time in this codebase (ClaimForm.tsx's document-upload
// proof method wanted this same pattern but had no matching presigned-url
// endpoint to call — see its own flagged gap comment; the location photos
// sub-resource does have one, documented in docs/API_CONTRACTS.md
// "Photos (`restaurant_photo`, sub-resource of `/locations/{id}`)").
//
// FIXED (manager photo-upload bug report): this previously PUT the raw
// file straight to `upload_url` with no body encoding, a leftover from
// before the backend's S3 resize pipeline (commit 3d7ce66, "complete the
// S3 image resize pipeline") switched `POST /locations/{id}/photos/
// upload-url` to a presigned **POST** (S3's `content-length-range`
// condition — needed for BRD 5.3's 5MB cap — only exists for presigned
// POST policies, not PUT; see docs/API_CONTRACTS.md and
// backend/app/services/s3_service.py's `generate_location_photo_upload_url`
// docstring). The frontend contract (`PhotoUploadUrlResponse`) never
// gained the `fields` the backend started returning, so every upload —
// owner, manager, or admin alike, this component is shared across all
// three (frontend/src/app/portal/locations/[id]/page.tsx) — PUT to a
// bucket-root URL with no signed policy and got back a non-2xx from S3,
// surfacing as the generic "Uploading the image failed" message below.
// It was reported against a manager session, but nothing here is
// manager-specific: the bug reproduces for every role since the same S3
// call path (and the same stale `fields`-less type) is shared by all of
// them; a manager was simply the first to exercise this screen since the
// resize pipeline shipped.
//
// Free/paid gallery limit (root CLAUDE.md "Tier model",
// backend/app/services/photo_service.py's `gallery_limit_for` — 2 free /
// 10 paid) is enforced here in the UI *before* attempting an upload, not
// just left to the API's 409 — the upload control disables itself with an
// explanation once the location is at its tier's limit.
//
// FLAGGED CONTRACT GAP (see this PR's description): `LocationDetail.
// cover_photo_url` is a resolved URL string with no accompanying photo id,
// so there is no documented way to explicitly remove an existing cover
// without replacing it (DELETE needs a photo_id we were never given for
// it). Uploading a new cover photo still works — the backend replaces the
// old cover as part of that same write ("cover replace, not stack") — and
// an existing gallery photo can be promoted to cover (its id is known).
// "Remove cover, leave none" is only possible here immediately after this
// session uploads a fresh cover (its id is then known locally).
import { useRef, useState } from "react";
import {
  createLocationPhotoAction,
  deleteLocationPhotoAction,
  getLocationPhotoUploadUrlAction,
  setLocationPhotoCoverAction,
} from "@/app/portal/locations/[id]/actions";
import { ImageIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import { postFileToS3 } from "@/lib/photoUpload";
import type { GalleryPhoto } from "@/types/location";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

function galleryLimitFor(isPaid: boolean): number {
  return isPaid ? 10 : 2;
}

export default function LocationPhotoManager({
  locationId,
  isPaid,
  initialCoverPhotoUrl,
  initialGalleryPhotos,
}: {
  locationId: number;
  isPaid: boolean;
  initialCoverPhotoUrl: string | null;
  initialGalleryPhotos: GalleryPhoto[];
}) {
  const [coverPhotoUrl, setCoverPhotoUrl] = useState(initialCoverPhotoUrl);
  const [coverPhotoId, setCoverPhotoId] = useState<number | null>(null);
  const [gallery, setGallery] = useState<GalleryPhoto[]>(
    [...initialGalleryPhotos].sort((a, b) => a.display_order - b.display_order)
  );
  const [coverError, setCoverError] = useState<string | null>(null);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [pendingPhotoId, setPendingPhotoId] = useState<number | null>(null);

  const coverInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const limit = galleryLimitFor(isPaid);
  const atLimit = gallery.length >= limit;

  async function uploadPhoto(file: File, isCover: boolean): Promise<
    { ok: true; url: string; id: number } | { ok: false; error: string }
  > {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return { ok: false, error: "Only JPEG, PNG, or WebP images are supported." };
    }

    const uploadUrlResult = await getLocationPhotoUploadUrlAction(locationId, file.type);
    if (!uploadUrlResult.ok) return { ok: false, error: uploadUrlResult.error };

    const uploadOk = await postFileToS3(
      uploadUrlResult.data.upload_url,
      uploadUrlResult.data.fields,
      file
    );
    if (!uploadOk) {
      return { ok: false, error: "Uploading the image failed. Please try again." };
    }

    const createResult = await createLocationPhotoAction(
      locationId,
      uploadUrlResult.data.s3_key,
      isCover
    );
    if (!createResult.ok) return { ok: false, error: createResult.error };

    return { ok: true, url: createResult.data.url, id: createResult.data.id };
  }

  async function handleCoverFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverError(null);
    setUploadingCover(true);
    try {
      const result = await uploadPhoto(file, true);
      if (result.ok) {
        setCoverPhotoUrl(result.url);
        setCoverPhotoId(result.id);
      } else {
        setCoverError(result.error);
      }
    } finally {
      setUploadingCover(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }

  async function handleGalleryFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setGalleryError(null);

    if (atLimit) {
      setGalleryError(
        `You've reached the ${limit}-photo gallery limit for this location's tier.`
      );
      return;
    }

    setUploadingGallery(true);
    try {
      const result = await uploadPhoto(file, false);
      if (result.ok) {
        setGallery((prev) => [
          ...prev,
          { id: result.id, url: result.url, display_order: prev.length },
        ]);
      } else {
        setGalleryError(result.error);
      }
    } finally {
      setUploadingGallery(false);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
  }

  async function handleRemoveCover() {
    if (coverPhotoId === null) return;
    setCoverError(null);
    setPendingPhotoId(coverPhotoId);
    try {
      const result = await deleteLocationPhotoAction(locationId, coverPhotoId);
      if (result.ok) {
        setCoverPhotoUrl(null);
        setCoverPhotoId(null);
      } else {
        setCoverError(result.error);
      }
    } finally {
      setPendingPhotoId(null);
    }
  }

  async function handleSetAsCover(photo: GalleryPhoto) {
    setGalleryError(null);
    setPendingPhotoId(photo.id);
    try {
      const result = await setLocationPhotoCoverAction(locationId, photo.id);
      if (result.ok) {
        setCoverPhotoUrl(result.data.url);
        setCoverPhotoId(result.data.id);
        setGallery((prev) => prev.filter((p) => p.id !== photo.id));
      } else {
        setGalleryError(result.error);
      }
    } finally {
      setPendingPhotoId(null);
    }
  }

  async function handleDeleteGalleryPhoto(photo: GalleryPhoto) {
    setGalleryError(null);
    setPendingPhotoId(photo.id);
    try {
      const result = await deleteLocationPhotoAction(locationId, photo.id);
      if (result.ok) {
        setGallery((prev) => prev.filter((p) => p.id !== photo.id));
      } else {
        setGalleryError(result.error);
      }
    } finally {
      setPendingPhotoId(null);
    }
  }

  return (
    <section
      aria-labelledby="photos-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2
        id="photos-heading"
        className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink"
      >
        <ImageIcon className="h-5 w-5 text-brand-ink-subtle" />
        Photos
      </h2>

      <div className="mt-4">
        <p className="text-sm font-semibold text-brand-ink">Cover photo</p>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          {coverPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote CloudFront URL
            <img
              src={coverPhotoUrl}
              alt="Current cover photo"
              className="h-24 w-32 rounded-brand-control border border-brand-border object-cover"
            />
          ) : (
            <div className="flex h-24 w-32 items-center justify-center rounded-brand-control border border-dashed border-brand-border text-xs text-brand-ink-subtle">
              No cover yet
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label
              htmlFor="cover-upload"
              className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-brand-control border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink transition hover:border-brand-ink-subtle"
            >
              <PlusIcon className="h-4 w-4" />
              {uploadingCover ? "Uploading..." : coverPhotoUrl ? "Replace cover photo" : "Upload cover photo"}
            </label>
            <input
              id="cover-upload"
              ref={coverInputRef}
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              onChange={handleCoverFileChange}
              disabled={uploadingCover}
              className="sr-only"
            />
            {coverPhotoId !== null && (
              <button
                type="button"
                onClick={handleRemoveCover}
                disabled={pendingPhotoId === coverPhotoId}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-brand-control border border-brand-closed px-4 text-sm font-semibold text-brand-closed transition hover:bg-brand-closed-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                <TrashIcon className="h-4 w-4" />
                Remove cover photo
              </button>
            )}
          </div>
        </div>
        {coverError && (
          <p className="mt-2 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
            {coverError}
          </p>
        )}
      </div>

      <div className="mt-6 border-t border-brand-border pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-brand-ink">
            Gallery photos ({gallery.length} of {limit} used)
          </p>
          {!isPaid && (
            <span className="text-xs text-brand-ink-subtle">
              Free tier — upgrade for up to 10 gallery photos.
            </span>
          )}
        </div>

        {gallery.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {gallery.map((photo) => (
              <div key={photo.id} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- remote CloudFront URL */}
                <img
                  src={photo.url}
                  alt="Gallery photo"
                  className="h-28 w-full rounded-brand-control border border-brand-border object-cover sm:h-32"
                />
                <div className="mt-1.5 flex items-center justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => handleSetAsCover(photo)}
                    disabled={pendingPhotoId === photo.id}
                    className="min-h-[44px] rounded-brand-control px-2 text-xs font-semibold text-brand-ink-muted underline decoration-brand-border underline-offset-2 hover:text-brand-ink disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Set as cover
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteGalleryPhoto(photo)}
                    disabled={pendingPhotoId === photo.id}
                    aria-label="Delete photo"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-brand-control text-brand-closed transition hover:bg-brand-closed-bg disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <label
            htmlFor="gallery-upload"
            className={
              atLimit || uploadingGallery
                ? "flex min-h-[44px] cursor-not-allowed items-center justify-center gap-2 rounded-brand-control border border-brand-border bg-brand-bg px-4 text-sm font-semibold text-brand-ink-subtle sm:w-auto"
                : "flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-brand-control border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink transition hover:border-brand-ink-subtle sm:w-auto"
            }
          >
            <PlusIcon className="h-4 w-4" />
            {uploadingGallery ? "Uploading..." : "Add gallery photo"}
          </label>
          <input
            id="gallery-upload"
            ref={galleryInputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            onChange={handleGalleryFileChange}
            disabled={atLimit || uploadingGallery}
            className="sr-only"
          />
          {atLimit && (
            <p className="mt-2 text-xs text-brand-ink-subtle">
              {isPaid
                ? `This location has reached its ${limit}-photo gallery limit.`
                : `Free-tier locations are limited to ${limit} gallery photos — upgrade to add more.`}
            </p>
          )}
        </div>

        {galleryError && (
          <p className="mt-2 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
            {galleryError}
          </p>
        )}
      </div>
    </section>
  );
}
