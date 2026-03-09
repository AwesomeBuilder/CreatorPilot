"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
        <Label htmlFor="format-pref" className="mb-1 block text-[var(--cp-ink)]">
          Format preference
        </Label>
        <Select
          value={preference}
          onValueChange={(value) => setPreference(value as RenderPreference)}
        >
          <SelectTrigger id="format-pref" className="w-full border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-sm text-[var(--cp-ink-soft)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto (recommended)</SelectItem>
            <SelectItem value="shorts">Shorts 1080x1920</SelectItem>
            <SelectItem value="landscape">Landscape 1920x1080</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-[var(--cp-muted-dim)]">Auto picks format based on source orientation + duration.</p>
      </div>

      <div>
        <p className="mb-1 text-sm font-medium text-[var(--cp-ink)]">Select media assets</p>
        <div className="grid gap-2 md:grid-cols-2">
          {assets.map((asset) => {
            const checked = effectiveSelected.includes(asset.id);
            const inputId = `asset-${asset.id}`;
            return (
              <div key={asset.id} className="flex items-center gap-2 rounded border border-[var(--cp-border)] px-2 py-1 text-xs">
                <Checkbox
                  id={inputId}
                  checked={checked}
                  onCheckedChange={() => toggleAsset(asset.id)}
                  className="border-[var(--cp-border-strong)]"
                />
                <Label htmlFor={inputId} className="truncate text-xs font-normal text-[var(--cp-muted)]">
                  {asset.path}
                </Label>
              </div>
            );
          })}
        </div>
      </div>

      <Button
        type="button"
        onClick={handleRender}
        disabled={isSubmitting || !idea || assets.length === 0}
        className="text-white"
      >
        {isSubmitting ? "Starting render..." : "Render 3 variants"}
      </Button>
      {error ? <p className="text-xs text-[var(--cp-error)]">{error}</p> : null}
    </div>
  );
}
