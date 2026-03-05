"use client";

import { useState } from "react";

type MediaAsset = {
  id: string;
  path: string;
  type: string;
};

type UploadPanelProps = {
  assets: MediaAsset[];
  onUploaded: (assets: MediaAsset[]) => void;
};

export function UploadPanel({ assets, onUploaded }: UploadPanelProps) {
  const [files, setFiles] = useState<FileList | null>(null);
  const [isUploading, setIsUploading] = useState(false);
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
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 p-3">
        <input
          type="file"
          accept=".mp4,.mov,.png,.jpg,.jpeg"
          multiple
          onChange={(event) => setFiles(event.target.files)}
          className="block w-full text-sm"
        />
        <button
          type="button"
          onClick={handleUpload}
          disabled={isUploading || !files || files.length === 0}
          className="mt-3 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isUploading ? "Uploading..." : "Upload media"}
        </button>
        {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Available assets ({assets.length})</h3>
        <ul className="space-y-1 text-xs text-slate-700">
          {assets.map((asset) => (
            <li key={asset.id} className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
              {asset.type.toUpperCase()} - {asset.path}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
