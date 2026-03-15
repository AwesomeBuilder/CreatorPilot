"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Idea, MediaRelevanceAssessment, RenderPreference } from "@/lib/types";

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
  const [assessment, setAssessment] = useState<MediaRelevanceAssessment | null>(null);
  const [isAssessing, setIsAssessing] = useState(false);
  const [allowIrrelevantMedia, setAllowIrrelevantMedia] = useState(false);

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

  useEffect(() => {
    let isCancelled = false;

    const runAssessment = async () => {
      if (!idea || effectiveSelected.length === 0) {
        setAssessment(null);
        setAllowIrrelevantMedia(false);
        return;
      }

      setIsAssessing(true);

      try {
        const response = await fetch("/api/media/relevance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idea,
            mediaAssetIds: effectiveSelected,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "Failed to assess uploaded media");
        }

        if (!isCancelled) {
          setAssessment(data.assessment ?? null);
          if (!data.assessment?.shouldBlock) {
            setAllowIrrelevantMedia(false);
          }
        }
      } catch {
        if (!isCancelled) {
          setAssessment(null);
        }
      } finally {
        if (!isCancelled) {
          setIsAssessing(false);
        }
      }
    };

    void runAssessment();

    return () => {
      isCancelled = true;
    };
  }, [effectiveSelected, idea]);

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
          allowIrrelevantMedia,
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

      {isAssessing ? <p className="text-xs text-[var(--cp-muted)]">Checking whether the uploaded media fits this idea...</p> : null}
      {assessment ? (
        <div
          className={`rounded border px-3 py-2 text-xs ${
            assessment.shouldBlock
              ? "border-[var(--cp-warning)] bg-[var(--cp-warning-bg)] text-[var(--cp-warning)]"
              : assessment.status === "relevant"
                ? "border-[var(--cp-success)] bg-[var(--cp-success-bg)] text-[var(--cp-success)]"
                : "border-[var(--cp-border)] bg-[var(--cp-surface-soft)] text-[var(--cp-muted)]"
          }`}
        >
          <p>{assessment.summary}</p>
          {assessment.matchedSignals.length > 0 ? (
            <p className="mt-1 text-[11px] opacity-80">Signals: {assessment.matchedSignals.join(", ")}</p>
          ) : null}
        </div>
      ) : null}
      {assessment?.shouldBlock ? (
        <div className="flex items-center gap-2 text-xs text-[var(--cp-muted)]">
          <Checkbox
            id="allow-irrelevant-media"
            checked={allowIrrelevantMedia}
            onCheckedChange={(checked) => setAllowIrrelevantMedia(checked === true)}
            className="border-[var(--cp-border-strong)]"
          />
          <Label htmlFor="allow-irrelevant-media" className="text-xs font-normal text-[var(--cp-muted)]">
            Render anyway with the current media
          </Label>
        </div>
      ) : null}

      <Button
        type="button"
        onClick={handleRender}
        disabled={isSubmitting || !idea || assets.length === 0 || (assessment?.shouldBlock === true && !allowIrrelevantMedia)}
        className="text-white"
      >
        {isSubmitting ? "Starting render..." : "Render 3 variants"}
      </Button>
      {error ? <p className="text-xs text-[var(--cp-error)]">{error}</p> : null}
    </div>
  );
}
