"use client";

import { useMemo, useState } from "react";

import type { Idea, RenderPreference } from "@/lib/types";

type MediaAsset = {
  id: string;
  path: string;
  type: string;
};

type RenderPanelProps = {
  idea: Idea | null;
  assets: MediaAsset[];
  onJobCreated: (jobId: string) => void;
};

export function RenderPanel({ idea, assets, onJobCreated }: RenderPanelProps) {
  const [preference, setPreference] = useState<RenderPreference>("auto");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSelected = useMemo(() => {
    if (selectedAssetIds.length > 0) {
      return selectedAssetIds;
    }

    return assets.map((asset) => asset.id);
  }, [assets, selectedAssetIds]);

  const toggleAsset = (assetId: string) => {
    setSelectedAssetIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId],
    );
  };

  const handleRender = async () => {
    if (!idea) {
      setError("Select an idea first.");
      return;
    }

    if (effectiveSelected.length === 0) {
      setError("Upload at least one media asset.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea,
          mediaAssetIds: effectiveSelected,
          preference,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Render failed to start");
      }

      onJobCreated(data.jobId);
    } catch (renderError) {
      setError(renderError instanceof Error ? renderError.message : "Render failed to start");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="format-pref" className="mb-1 block text-sm font-medium text-slate-900">
          Format preference
        </label>
        <select
          id="format-pref"
          value={preference}
          onChange={(event) => setPreference(event.target.value as RenderPreference)}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="auto">Auto (recommended)</option>
          <option value="shorts">Shorts 1080x1920</option>
          <option value="landscape">Landscape 1920x1080</option>
        </select>
        <p className="mt-1 text-xs text-slate-500">Auto picks format based on source orientation + duration.</p>
      </div>

      <div>
        <p className="mb-1 text-sm font-medium text-slate-900">Select media assets</p>
        <div className="grid gap-2 md:grid-cols-2">
          {assets.map((asset) => {
            const checked = effectiveSelected.includes(asset.id);
            return (
              <label key={asset.id} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1 text-xs">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleAsset(asset.id)}
                  className="h-3 w-3"
                />
                <span className="truncate">{asset.path}</span>
              </label>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={handleRender}
        disabled={isSubmitting || !idea || assets.length === 0}
        className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isSubmitting ? "Starting render..." : "Render 3 variants"}
      </button>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
