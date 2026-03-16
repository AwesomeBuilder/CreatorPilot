"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MediaAsset = {
  id: string;
  path: string;
  type: string;
};

type UploadPanelProps = {
  assets: MediaAsset[];
  onUploaded: (assets: MediaAsset[]) => void;
  onDeleted: (asset: MediaAsset) => void;
};

export function UploadPanel({ assets, onUploaded, onDeleted }: UploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [confirmingAssetId, setConfirmingAssetId] = useState<string | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async () => {
    if (!files || files.length === 0) {
      return;
    }

    setIsUploading(true);
    setError(null);

    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }

    try {
      const response = await fetch("/api/media", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Upload failed");
      }

      onUploaded(data.uploaded ?? []);
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

  const handleDelete = async (asset: MediaAsset) => {
    setConfirmingAssetId(null);
    setDeletingAssetId(asset.id);
    setError(null);

    try {
      const response = await fetch(`/api/media/${asset.id}`, {
        method: "DELETE",
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Delete failed");
      }

      onDeleted((data.deleted as MediaAsset | undefined) ?? asset);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed");
    } finally {
      setDeletingAssetId(null);
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
            onChange={(event) => setFiles(event.target.files)}
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

      <div>
        <h3 className="mb-2 text-sm font-semibold text-[var(--cp-ink)]">Available assets ({assets.length})</h3>
        {assets.length > 0 ? (
          <ul className="space-y-2 text-xs text-[var(--cp-muted)]">
            {assets.map((asset) => {
              const isConfirming = confirmingAssetId === asset.id;
              const isDeleting = deletingAssetId === asset.id;
              const assetName = asset.path.split(/[/\\]/).at(-1) ?? asset.path;

              return (
                <li
                  key={asset.id}
                  className="flex items-center justify-between gap-3 rounded border border-[var(--cp-border)] bg-[var(--cp-surface-soft)] px-2 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[var(--cp-ink)]">{assetName}</p>
                    <p className="mt-1 uppercase tracking-wide text-[11px] text-[var(--cp-muted)]">{asset.type}</p>
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
