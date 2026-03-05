"use client";

import { useMemo, useState } from "react";

type YoutubeStatus = {
  connected: boolean;
  mode: "mock" | "live";
  reason: string;
};

type RenderVariantOption = {
  id: string;
  label: string;
  path: string;
};

type MetadataInput = {
  youtubeTitle: string;
  description: string;
  tags: string[];
};

type ScheduleInput = {
  publishAt: string;
};

type YoutubePanelProps = {
  status: YoutubeStatus | null;
  metadata: MetadataInput | null;
  schedule: ScheduleInput | null;
  variants: RenderVariantOption[];
  onConnect: () => void;
  onUpload: (payload: { renderId: string; publishAt?: string }) => void;
  isUploading: boolean;
};

export function YoutubePanel({
  status,
  metadata,
  schedule,
  variants,
  onConnect,
  onUpload,
  isUploading,
}: YoutubePanelProps) {
  const defaultVariant = variants[0]?.id ?? "";
  const [selectedRenderId, setSelectedRenderId] = useState(defaultVariant);
  const [useSchedule, setUseSchedule] = useState(true);

  const effectiveRenderId = variants.some((variant) => variant.id === selectedRenderId)
    ? selectedRenderId
    : defaultVariant;

  const canUpload = useMemo(
    () => Boolean(metadata && effectiveRenderId && variants.length > 0),
    [metadata, effectiveRenderId, variants.length],
  );

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 p-3">
        <p className="text-sm font-semibold text-slate-900">YouTube connection</p>
        <p className="text-xs text-slate-700">
          Mode: <strong>{status?.mode ?? "unknown"}</strong> - {status?.reason ?? "Status unavailable"}
        </p>
        <button
          type="button"
          onClick={onConnect}
          className="mt-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100"
        >
          Connect YouTube
        </button>
      </section>

      <section className="rounded-lg border border-slate-200 p-3">
        <p className="text-sm font-semibold text-slate-900">Upload render</p>
        <label className="mb-1 mt-2 block text-xs font-medium text-slate-700">Variant</label>
        <select
          value={effectiveRenderId}
          onChange={(event) => setSelectedRenderId(event.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {variants.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.label}
            </option>
          ))}
        </select>

        <label className="mt-3 flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={useSchedule}
            onChange={(event) => setUseSchedule(event.target.checked)}
            disabled={!schedule}
          />
          Apply recommended schedule (best effort)
        </label>
        {!status || status.mode === "mock" ? (
          <p className="mt-2 text-xs text-amber-700">Currently in mock mode. Upload call will be simulated.</p>
        ) : null}

        <button
          type="button"
          disabled={!canUpload || isUploading}
          onClick={() => onUpload({ renderId: effectiveRenderId, publishAt: useSchedule ? schedule?.publishAt : undefined })}
          className="mt-3 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isUploading ? "Starting upload..." : "Upload to YouTube (private)"}
        </button>
      </section>
    </div>
  );
}
