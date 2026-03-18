"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatApiErrorMessage, readApiResponse } from "@/lib/api-response";
import { formatLegacyUploadTooLargeMessage, validateClientMediaUpload } from "@/lib/media-upload";
import type { MediaAssetRecord, MediaUploadMode } from "@/lib/types";

type UploadPanelProps = {
  assets: MediaAssetRecord[];
  uploadMode: MediaUploadMode;
  onUploaded: (assets: MediaAssetRecord[]) => void;
  onDeleted: (asset: MediaAssetRecord) => void;
  onAssetsReload?: () => Promise<void> | void;
};

type UploadQueueItem = {
  localId: string;
  file: File;
  filename: string;
  progress: number;
  status: "requesting" | "uploading" | "finalizing" | "failed";
  assetId?: string;
  error?: string;
};

function formatSize(sizeBytes: number | null) {
  if (typeof sizeBytes !== "number" || sizeBytes <= 0) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = sizeBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function uploadStatusTone(status: UploadQueueItem["status"] | MediaAssetRecord["status"]) {
  if (status === "ready" || status === "finalizing") {
    return "text-[var(--cp-success)]";
  }

  if (status === "failed") {
    return "text-[var(--cp-error)]";
  }

  return "text-[var(--cp-warning)]";
}

function uploadStatusLabel(status: UploadQueueItem["status"] | MediaAssetRecord["status"]) {
  if (status === "requesting") return "Preparing upload";
  if (status === "uploading") return "Uploading";
  if (status === "finalizing") return "Finalizing";
  if (status === "pending") return "Pending";
  if (status === "failed") return "Failed";
  return "Ready";
}

function assetDisplayName(asset: Pick<MediaAssetRecord, "filename" | "path">) {
  const preferred = asset.filename.trim();
  return preferred.length > 0 ? preferred : asset.path.split(/[/\\]/).at(-1) ?? asset.path;
}

export function UploadPanel({ assets, uploadMode, onUploaded, onDeleted, onAssetsReload }: UploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [confirmingAssetId, setConfirmingAssetId] = useState<string | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);

  const currentHostname = () => (typeof window === "undefined" ? undefined : window.location.hostname);
  const directUploadsEnabled = uploadMode === "direct";

  const replaceQueueItem = (localId: string, updater: (item: UploadQueueItem) => UploadQueueItem) => {
    setUploadQueue((current) => current.map((item) => (item.localId === localId ? updater(item) : item)));
  };

  const requestDirectUploadSession = async (file: File) => {
    const response = await fetch("/api/media/upload-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || undefined,
        sizeBytes: file.size,
      }),
    });

    const { data, text } = await readApiResponse<{
      assetId: string;
      uploadUrl: string;
      asset: MediaAssetRecord;
      error?: string;
    }>(response);

    if (!response.ok || !data) {
      throw new Error(
        formatApiErrorMessage({
          response,
          payload: data,
          text,
          fallback: "Failed to start direct upload",
        }),
      );
    }

    return data;
  };

  const finalizeDirectUpload = async (assetId: string) => {
    const response = await fetch("/api/media/upload-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId }),
    });

    const { data, text } = await readApiResponse<{ asset?: MediaAssetRecord; error?: string }>(response);
    if (!response.ok || !data?.asset) {
      throw new Error(
        formatApiErrorMessage({
          response,
          payload: data,
          text,
          fallback: "Failed to finalize direct upload",
        }),
      );
    }

    return data.asset;
  };

  const markDirectUploadFailed = async (assetId: string) => {
    const response = await fetch("/api/media/upload-failed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId }),
    });

    const { data, text } = await readApiResponse<{ error?: string }>(response);
    if (!response.ok) {
      throw new Error(
        formatApiErrorMessage({
          response,
          payload: data,
          text,
          fallback: "Failed to mark upload as failed",
        }),
      );
    }
  };

  const uploadFileToResumableSession = async (file: File, uploadUrl: string, onProgress: (progress: number) => void) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          return;
        }

        onProgress(Math.max(1, Math.min(99, Math.round((event.loaded / event.total) * 100))));
      };
      xhr.onerror = () => {
        reject(new Error("Direct upload failed. Check bucket CORS and storage permissions."));
      };
      xhr.onabort = () => {
        reject(new Error("Direct upload was canceled."));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }

        reject(new Error(xhr.responseText?.trim() || `Direct upload failed with HTTP ${xhr.status}.`));
      };
      xhr.send(file);
    });

  const deleteAssetById = async (assetId: string) => {
    const response = await fetch(`/api/media/${assetId}`, {
      method: "DELETE",
    });

    const { data, text } = await readApiResponse<{ deleted?: MediaAssetRecord; error?: string }>(response);
    if (!response.ok || !data?.deleted) {
      throw new Error(
        formatApiErrorMessage({
          response,
          payload: data,
          text,
          fallback: "Delete failed",
        }),
      );
    }

    return data.deleted;
  };

  const runDirectUpload = async (item: UploadQueueItem, options?: { retry?: boolean }) => {
    let assetId = item.assetId;

    try {
      if (options?.retry && assetId) {
        await deleteAssetById(assetId).catch(() => undefined);
        await onAssetsReload?.();
        assetId = undefined;
      }

      replaceQueueItem(item.localId, (current) => ({
        ...current,
        assetId,
        error: undefined,
        progress: 0,
        status: "requesting",
      }));

      const session = await requestDirectUploadSession(item.file);
      assetId = session.assetId;
      replaceQueueItem(item.localId, (current) => ({
        ...current,
        assetId: session.assetId,
        progress: 1,
        status: "uploading",
      }));
      await onAssetsReload?.();

      await uploadFileToResumableSession(item.file, session.uploadUrl, (progress) => {
        replaceQueueItem(item.localId, (current) => ({
          ...current,
          progress,
          status: "uploading",
        }));
      });

      replaceQueueItem(item.localId, (current) => ({
        ...current,
        progress: 100,
        status: "finalizing",
      }));

      const completedAsset = await finalizeDirectUpload(session.assetId);
      await onAssetsReload?.();
      setUploadQueue((current) => current.filter((queued) => queued.localId !== item.localId));
      return completedAsset;
    } catch (uploadError) {
      if (assetId) {
        await markDirectUploadFailed(assetId).catch(() => undefined);
        await onAssetsReload?.();
      }

      const message = uploadError instanceof Error ? uploadError.message : "Direct upload failed";
      replaceQueueItem(item.localId, (current) => ({
        ...current,
        assetId,
        error: message,
        status: "failed",
      }));
      return null;
    }
  };

  const handleUpload = async () => {
    if (!files || files.length === 0) {
      return;
    }

    const validationError = validateClientMediaUpload({
      files: Array.from(files),
      hostname: currentHostname(),
      uploadMode,
    });

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      if (directUploadsEnabled) {
        const selectedFiles = Array.from(files);
        const queueItems = selectedFiles.map((file, index) => ({
          localId: `${Date.now()}-${index}-${file.name}`,
          file,
          filename: file.name,
          progress: 0,
          status: "requesting" as const,
        }));
        setUploadQueue((current) => [...queueItems, ...current]);

        const uploadedAssets: MediaAssetRecord[] = [];
        for (const item of queueItems) {
          const completedAsset = await runDirectUpload(item);
          if (completedAsset) {
            uploadedAssets.push(completedAsset);
          }
        }

        if (uploadedAssets.length > 0) {
          onUploaded(uploadedAssets);
        }
      } else {
        const formData = new FormData();
        for (const file of files) {
          formData.append("files", file);
        }

        const response = await fetch("/api/media", {
          method: "POST",
          body: formData,
        });

        const { data, text } = await readApiResponse<{ uploaded?: MediaAssetRecord[]; error?: string }>(response);
        if (!response.ok) {
          throw new Error(
            response.status === 413
              ? formatLegacyUploadTooLargeMessage()
              : formatApiErrorMessage({
                  response,
                  payload: data,
                  text,
                  fallback: "Upload failed",
                }),
          );
        }

        if (!data) {
          throw new Error("Upload failed: server returned an invalid response.");
        }

        onUploaded(data.uploaded ?? []);
      }

      setFiles(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (asset: MediaAssetRecord) => {
    setConfirmingAssetId(null);
    setDeletingAssetId(asset.id);
    setError(null);

    try {
      const deletedAsset = await deleteAssetById(asset.id);
      setUploadQueue((current) => current.filter((item) => item.assetId !== asset.id));
      onDeleted(deletedAsset);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed");
    } finally {
      setDeletingAssetId(null);
    }
  };

  const handleRetry = async (localId: string) => {
    const item = uploadQueue.find((entry) => entry.localId === localId);
    if (!item) {
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const completedAsset = await runDirectUpload(item, { retry: true });
      if (completedAsset) {
        onUploaded([completedAsset]);
      }
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="border-[var(--cp-border)] py-0 ring-0">
        <CardContent className="p-3">
          <Label htmlFor="media-files" className="text-[var(--cp-ink-soft)]">
            Choose media files
          </Label>
          <Input
            id="media-files"
            ref={fileInputRef}
            type="file"
            accept=".mp4,.mov,.png,.jpg,.jpeg"
            multiple
            onChange={(event) => {
              setError(null);

              const nextFiles = event.target.files;
              const validationError = validateClientMediaUpload({
                files: Array.from(nextFiles ?? []),
                hostname: currentHostname(),
                uploadMode,
              });

              if (validationError) {
                setFiles(null);
                event.target.value = "";
                setError(validationError);
                return;
              }

              setFiles(nextFiles);
            }}
            className="mt-2 h-auto border-[var(--cp-border-strong)] bg-[var(--cp-surface)] py-2 text-sm text-[var(--cp-ink-soft)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--cp-surface-soft)] file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-[var(--cp-ink-soft)] hover:file:bg-[var(--cp-surface-muted)]"
          />
          <p className="mt-2 text-xs text-[var(--cp-muted-soft)]">
            {files && files.length > 0
              ? `${files.length} file${files.length > 1 ? "s" : ""} selected`
              : "No files selected yet. Select files to enable upload."}
          </p>
          <p className="mt-2 text-xs text-[var(--cp-muted-dim)]">
            Uploaded media can be linked into idea generation and is always available during render analysis.
          </p>
          {directUploadsEnabled ? (
            <p className="mt-2 text-xs text-[var(--cp-muted)]">
              Large files upload directly to Cloud Storage with progress tracking. Only assets marked <span className="font-medium">Ready</span> become selectable.
            </p>
          ) : null}
          <Button
            type="button"
            onClick={handleUpload}
            disabled={isUploading || deletingAssetId !== null || !files || files.length === 0}
            className="mt-3 text-white"
          >
            {isUploading ? "Uploading..." : "Upload media"}
          </Button>
          {!files || files.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--cp-muted-dim)]">Upload stays disabled until you choose at least one file.</p>
          ) : null}
          {error ? <p className="mt-2 text-xs text-[var(--cp-error)]">{error}</p> : null}
        </CardContent>
      </Card>

      {uploadQueue.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-[var(--cp-ink)]">Active uploads ({uploadQueue.length})</h3>
          <ul className="space-y-2 text-xs text-[var(--cp-muted)]">
            {uploadQueue.map((item) => (
              <li
                key={item.localId}
                className="rounded border border-[var(--cp-border)] bg-[var(--cp-surface-soft)] px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[var(--cp-ink)]">{item.filename}</p>
                    <p className={`mt-1 text-[11px] font-semibold ${uploadStatusTone(item.status)}`}>{uploadStatusLabel(item.status)}</p>
                    {item.error ? <p className="mt-1 text-[11px] text-[var(--cp-error)]">{item.error}</p> : null}
                  </div>
                  {item.status === "failed" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={isUploading || deletingAssetId !== null}
                      onClick={() => {
                        void handleRetry(item.localId);
                      }}
                    >
                      Retry
                    </Button>
                  ) : null}
                </div>
                <div className="mt-2 h-2 rounded-full bg-[var(--cp-border)]">
                  <div
                    className="h-2 rounded-full bg-[var(--cp-link)] transition-[width]"
                    style={{ width: `${Math.max(4, item.progress)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-[var(--cp-muted)]">{item.progress}%</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-[var(--cp-ink)]">Available assets ({assets.length})</h3>
        {assets.length > 0 ? (
          <ul className="space-y-2 text-xs text-[var(--cp-muted)]">
            {assets.map((asset) => {
              const isConfirming = confirmingAssetId === asset.id;
              const isDeleting = deletingAssetId === asset.id;
              const assetName = assetDisplayName(asset);
              const sizeLabel = formatSize(asset.sizeBytes);

              return (
                <li
                  key={asset.id}
                  className="flex items-center justify-between gap-3 rounded border border-[var(--cp-border)] bg-[var(--cp-surface-soft)] px-2 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[var(--cp-ink)]">{assetName}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide">
                      <span className="text-[var(--cp-muted)]">{asset.type}</span>
                      <span className={uploadStatusTone(asset.status)}>{uploadStatusLabel(asset.status)}</span>
                      {sizeLabel ? <span className="normal-case tracking-normal text-[var(--cp-muted-dim)]">{sizeLabel}</span> : null}
                    </p>
                    {asset.status !== "ready" ? (
                      <p className="mt-1 text-[11px] text-[var(--cp-muted-dim)]">
                        {asset.status === "pending"
                          ? "Upload is still pending. It becomes selectable once the direct upload finishes."
                          : "Upload failed. Delete this entry and reselect the file to try again."}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isConfirming ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={isUploading || deletingAssetId !== null}
                        onClick={() => setConfirmingAssetId(null)}
                      >
                        Cancel
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="destructive"
                      size="xs"
                      disabled={isUploading || deletingAssetId !== null}
                      onClick={() => {
                        if (isConfirming) {
                          void handleDelete(asset);
                          return;
                        }

                        setError(null);
                        setConfirmingAssetId(asset.id);
                      }}
                    >
                      {isDeleting ? "Deleting..." : isConfirming ? "Confirm delete" : "Delete"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-[var(--cp-muted-soft)]">No uploaded assets yet.</p>
        )}
      </div>
    </div>
  );
}
