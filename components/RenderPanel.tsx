"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { applyStoryboardEditorialTiming, formatSecondsLabel } from "@/lib/editorial";
import type { Idea, RenderPreference, StoryboardBeat, StoryboardPlan, Trend, WorkflowMode } from "@/lib/types";

type MediaAsset = {
  id: string;
  path: string;
  type: string;
};

type RenderPanelProps = {
  trend: Trend | null;
  idea: Idea | null;
  assets: MediaAsset[];
  onJobCreated: (jobId: string) => void;
  mode?: WorkflowMode;
  defaultSelectedAssetIds?: string[];
  selectionKey?: string;
  selectionDescription?: string;
  emptySelectionUsesAllAssets?: boolean;
};

function coverageTone(level: StoryboardBeat["coverageLevel"]) {
  switch (level) {
    case "strong":
      return "border-[var(--cp-success)] bg-[var(--cp-success-bg)] text-[var(--cp-success)]";
    case "usable":
      return "border-[var(--cp-primary)] bg-[var(--cp-highlight)] text-[var(--cp-deep)]";
    case "weak":
      return "border-[var(--cp-warning)] bg-[var(--cp-warning-bg)] text-[var(--cp-warning)]";
    default:
      return "border-[var(--cp-error)] bg-[var(--cp-error-bg)] text-[var(--cp-error)]";
  }
}

function sourceLabel(beat: StoryboardBeat) {
  if (beat.mediaSource === "generated") return "Generated support";
  if (beat.mediaSource === "synthetic") return "Fallback card";
  if (beat.mediaSource === "user") {
    if (beat.assetType === "video") return "Matched video shot";
    if ((beat.supportingVisuals?.length ?? 0) > 0) return `Visual sequence (${(beat.supportingVisuals?.length ?? 0) + 1})`;
    return beat.cropWindow?.label ? `Auto-tightened ${beat.cropWindow.label}` : "Uploaded visual";
  }
  return "Needs media";
}

function timeRange(beat: StoryboardBeat) {
  if (typeof beat.shotStartSeconds !== "number" || typeof beat.shotEndSeconds !== "number") {
    return null;
  }

  return `${beat.shotStartSeconds.toFixed(1)}s - ${beat.shotEndSeconds.toFixed(1)}s`;
}

function generatedPreviewUrl(previewPath?: string | null) {
  return previewPath ? `/api/storyboard/preview?path=${encodeURIComponent(previewPath)}` : null;
}

function BeatPreviewFrame({ beat, format }: { beat: StoryboardBeat; format: StoryboardPlan["format"] }) {
  const userPreviewUrl = beat.selectedAssetId ? `/api/media/${beat.selectedAssetId}` : null;
  const generatedUrl = generatedPreviewUrl(beat.generatedPreviewPath ?? beat.selectedAssetPath);
  const previewUrl = beat.mediaSource === "generated" ? generatedUrl : userPreviewUrl;
  const leadCue = beat.subtitleCues?.[0]?.text ?? beat.caption;
  const timelineLabel =
    typeof beat.timelineStartSeconds === "number" && typeof beat.timelineEndSeconds === "number"
      ? `${formatSecondsLabel(beat.timelineStartSeconds)} - ${formatSecondsLabel(beat.timelineEndSeconds)}`
      : null;

  return (
    <div className={`relative overflow-hidden rounded-xl border border-[var(--cp-border)] bg-[#09101f] ${format === "shorts" ? "aspect-[9/16]" : "aspect-video"}`}>
      {previewUrl ? (
        beat.mediaSource === "user" && beat.assetType === "video" ? (
          <video src={previewUrl} muted preload="metadata" className="absolute inset-0 h-full w-full object-cover opacity-75" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt={beat.title} className="absolute inset-0 h-full w-full object-cover opacity-75" />
        )
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(251,146,60,0.32),_transparent_48%),linear-gradient(180deg,_#172554_0%,_#0f172a_100%)]" />
      )}
      <div
        className="absolute left-3 top-3 max-w-[78%] rounded-xl border border-white/12 bg-[rgba(9,16,31,0.82)] px-3 py-2 text-white"
        style={{ fontFamily: '"Avenir Next", "Helvetica Neue", sans-serif' }}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--cp-primary-soft,#fbbf24)]">
          {beat.titleOverlay?.label ?? beat.purpose}
        </p>
        <p className="mt-1 text-sm font-semibold leading-tight">{beat.titleOverlay?.text ?? beat.title}</p>
      </div>
      {timelineLabel ? (
        <div className="absolute right-3 top-3 rounded-full bg-[rgba(9,16,31,0.78)] px-2.5 py-1 text-[10px] font-medium tracking-[0.14em] text-white/80">
          {timelineLabel}
        </div>
      ) : null}
      <div
        className="absolute inset-x-4 bottom-6 rounded-2xl border border-white/10 bg-[rgba(4,10,24,0.82)] px-4 py-3 text-white"
        style={{ fontFamily: '"Helvetica Neue", "Avenir Next", sans-serif' }}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--cp-primary-soft,#fbbf24)]">Subtitle cue</p>
        <p className="mt-1 text-sm font-semibold leading-tight">{leadCue}</p>
      </div>
    </div>
  );
}

function normalizeSelectedAssetIds(params: {
  requested?: string[];
  assets: MediaAsset[];
  emptySelectionUsesAllAssets: boolean;
}) {
  const available = new Set(params.assets.map((asset) => asset.id));
  const requested = (params.requested ?? []).filter((assetId) => available.has(assetId));

  if (requested.length > 0) {
    return requested;
  }

  return params.emptySelectionUsesAllAssets ? params.assets.map((asset) => asset.id) : [];
}

export function RenderPanel({
  trend,
  idea,
  assets,
  onJobCreated,
  mode = "trend",
  defaultSelectedAssetIds,
  selectionKey,
  selectionDescription,
  emptySelectionUsesAllAssets = true,
}: RenderPanelProps) {
  const [preference, setPreference] = useState<RenderPreference>("auto");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(() =>
    normalizeSelectedAssetIds({
      requested: defaultSelectedAssetIds,
      assets,
      emptySelectionUsesAllAssets,
    }),
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storyboard, setStoryboard] = useState<StoryboardPlan | null>(null);
  const [analysisKey, setAnalysisKey] = useState<string | null>(null);

  useEffect(() => {
    setSelectedAssetIds(
      normalizeSelectedAssetIds({
        requested: defaultSelectedAssetIds,
        assets,
        emptySelectionUsesAllAssets,
      }),
    );
    setStoryboard(null);
    setAnalysisKey(null);
    setError(null);
  }, [assets, defaultSelectedAssetIds, emptySelectionUsesAllAssets, selectionKey]);

  const effectiveSelected = useMemo(() => selectedAssetIds, [selectedAssetIds]);

  const currentKey = useMemo(
    () =>
      JSON.stringify({
        trendTitle: trend?.trendTitle ?? null,
        ideaTitle: idea?.videoTitle ?? null,
        hook: idea?.hook ?? null,
        assets: [...effectiveSelected].sort(),
        preference,
      }),
    [effectiveSelected, idea?.hook, idea?.videoTitle, preference, trend?.trendTitle],
  );
  const storyboardIsCurrent = Boolean(storyboard && analysisKey === currentKey);
  const previewStoryboard = useMemo(() => (storyboard ? applyStoryboardEditorialTiming(storyboard) : null), [storyboard]);

  const toggleAsset = (assetId: string) => {
    setSelectedAssetIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId],
    );
  };

  const analyzeStoryboard = async () => {
    if (!trend || !idea) {
      setError(mode === "media-led" ? "Generate a story angle first." : "Select a trend and idea first.");
      return;
    }

    if (effectiveSelected.length === 0) {
      setError("Upload at least one media asset.");
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await fetch("/api/storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trend,
          idea,
          mediaAssetIds: effectiveSelected,
          preference,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to analyze coverage");
      }

      setStoryboard(data.storyboard ?? null);
      setAnalysisKey(currentKey);
    } catch (analysisError) {
      setStoryboard(null);
      setAnalysisKey(null);
      setError(analysisError instanceof Error ? analysisError.message : "Failed to analyze coverage");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRender = async () => {
    if (!trend || !idea) {
      setError(mode === "media-led" ? "Generate a story angle first." : "Select a trend and idea first.");
      return;
    }

    if (!storyboard || !storyboardIsCurrent) {
      setError("Analyze coverage first so the render uses the current storyboard.");
      return;
    }

    if (storyboard.shouldBlock) {
      setError("Coverage is too weak. Upload more relevant media before rendering.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trend,
          idea,
          mediaAssetIds: effectiveSelected,
          preference,
          allowIrrelevantMedia: false,
          storyboard,
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
    <div className="min-w-0 space-y-4">
      <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Card className="border-[var(--cp-border)] py-0 ring-0">
            <CardContent className="space-y-4 p-4">
              <div>
                <Label htmlFor="format-pref" className="mb-1 block text-[var(--cp-ink)]">
                  Format preference
                </Label>
                <Select value={preference} onValueChange={(value) => setPreference(value as RenderPreference)}>
                  <SelectTrigger
                    id="format-pref"
                    className="w-full border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-sm text-[var(--cp-ink-soft)]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (recommended)</SelectItem>
                    <SelectItem value="shorts">Shorts 1080x1920</SelectItem>
                    <SelectItem value="landscape">Landscape 1920x1080</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-[var(--cp-muted-dim)]">The storyboard locks to this format so the preview matches the final render.</p>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-[var(--cp-ink)]">Media selection</p>
                <p className="mb-2 text-[11px] text-[var(--cp-muted-dim)]">
                  {selectionDescription ?? "Pick which uploaded assets should be used for coverage analysis and rendering."}
                </p>
                <div className="grid max-h-[min(46vh,26rem)] gap-2 overflow-y-auto pr-1">
                  {assets.map((asset) => {
                    const checked = effectiveSelected.includes(asset.id);
                    const inputId = `asset-${asset.id}`;
                    return (
                      <div key={asset.id} className="rounded border border-[var(--cp-border)] bg-[var(--cp-surface-soft)] px-3 py-2">
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id={inputId}
                            checked={checked}
                            onCheckedChange={() => toggleAsset(asset.id)}
                            className="mt-0.5 border-[var(--cp-border-strong)]"
                          />
                          <div className="min-w-0 flex-1">
                            <Label htmlFor={inputId} className="block truncate text-xs font-medium text-[var(--cp-ink)]">
                              {asset.path}
                            </Label>
                            <p className="mt-1 text-[11px] uppercase tracking-wide text-[var(--cp-muted)]">{asset.type}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Button
                type="button"
                onClick={analyzeStoryboard}
                disabled={isAnalyzing || !trend || !idea || effectiveSelected.length === 0}
                className="w-full text-white"
              >
                {isAnalyzing ? "Analyzing coverage..." : storyboardIsCurrent ? "Refresh storyboard" : "Analyze coverage + storyboard"}
              </Button>
              <p className="text-xs text-[var(--cp-muted-dim)]">
                Rendering is disabled until the current trend, idea, assets, and format have been analyzed together.
              </p>
            </CardContent>
          </Card>

          <Button
            type="button"
            onClick={handleRender}
            disabled={isSubmitting || !storyboardIsCurrent || storyboard?.shouldBlock === true}
            className="w-full text-white"
          >
            {isSubmitting ? "Starting render..." : "Render 3 storyboard variants"}
          </Button>
          {error ? <p className="text-xs text-[var(--cp-error)]">{error}</p> : null}
        </div>

        <div className="min-w-0 space-y-4">
          {!previewStoryboard ? (
            <Card className="border-[var(--cp-border)] py-0 ring-0">
              <CardContent className="p-4 text-sm text-[var(--cp-muted)]">
                Analyze coverage to inspect the beat plan, selected shots, weak spots, and any generated support before rendering.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="border-[var(--cp-border)] py-0 ring-0">
                <CardContent className="space-y-4 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[var(--cp-highlight)] px-2.5 py-1 text-xs font-semibold text-[var(--cp-deep)]">
                      Coverage {previewStoryboard.coverageScore}/100
                    </span>
                    <span className="rounded-full border border-[var(--cp-border)] px-2.5 py-1 text-xs font-medium text-[var(--cp-muted)]">
                      {previewStoryboard.format === "shorts" ? "Shorts layout" : "Landscape layout"}
                    </span>
                    {previewStoryboard.diagnostics ? (
                      <span className="rounded-full border border-[var(--cp-border)] px-2.5 py-1 text-xs font-medium text-[var(--cp-muted)]">
                        Multimodal {previewStoryboard.diagnostics.multimodalStatus}
                      </span>
                    ) : null}
                    {previewStoryboard.diagnostics ? (
                      <span className="rounded-full border border-[var(--cp-border)] px-2.5 py-1 text-xs font-medium text-[var(--cp-muted)]">
                        Image gen {previewStoryboard.diagnostics.imageGenerationStatus}
                      </span>
                    ) : null}
                    {previewStoryboard.generatedSupportUsed ? (
                      <span className="rounded-full border border-[var(--cp-warning)] bg-[var(--cp-warning-bg)] px-2.5 py-1 text-xs font-medium text-[var(--cp-warning)]">
                        Generated support planned
                      </span>
                    ) : null}
                    {previewStoryboard.generatedSupportEnabled === false ? (
                      <span className="rounded-full border border-[var(--cp-border)] px-2.5 py-1 text-xs font-medium text-[var(--cp-muted)]">
                        Generated support disabled
                      </span>
                    ) : null}
                    {previewStoryboard.diagnostics?.generatedPreviewCount ? (
                      <span className="rounded-full border border-[var(--cp-border)] px-2.5 py-1 text-xs font-medium text-[var(--cp-muted)]">
                        {previewStoryboard.diagnostics.generatedPreviewCount} generated preview{previewStoryboard.diagnostics.generatedPreviewCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    {!storyboardIsCurrent ? (
                      <span className="rounded-full border border-[var(--cp-warning)] bg-[var(--cp-warning-bg)] px-2.5 py-1 text-xs font-medium text-[var(--cp-warning)]">
                        Stale analysis
                      </span>
                    ) : null}
                  </div>

                  <div className="overflow-hidden rounded-full bg-[var(--cp-surface-soft)]">
                    <div className="h-2 bg-[var(--cp-primary)]" style={{ width: `${previewStoryboard.coverageScore}%` }} />
                  </div>

                  <div
                    className={`rounded-lg border px-3 py-3 text-sm ${
                      previewStoryboard.shouldBlock
                        ? "border-[var(--cp-error)] bg-[var(--cp-error-bg)] text-[var(--cp-error)]"
                        : "border-[var(--cp-border)] bg-[var(--cp-surface-soft)] text-[var(--cp-muted)]"
                    }`}
                  >
                    {previewStoryboard.coverageSummary}
                  </div>

                  {previewStoryboard.diagnostics?.multimodalFailureReasons.length ? (
                    <div className="rounded-lg border border-[var(--cp-warning)] bg-[var(--cp-warning-bg)] px-3 py-3 text-sm text-[var(--cp-warning)]">
                      <p className="font-semibold">Why multimodal analysis fell back</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                        {previewStoryboard.diagnostics.multimodalFailureReasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {previewStoryboard.diagnostics?.imageGenerationFailureReasons.length ? (
                    <div className="rounded-lg border border-[var(--cp-warning)] bg-[var(--cp-warning-bg)] px-3 py-3 text-sm text-[var(--cp-warning)]">
                      <p className="font-semibold">Why generated previews are unavailable</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                        {previewStoryboard.diagnostics.imageGenerationFailureReasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {previewStoryboard.recommendedUploads && previewStoryboard.recommendedUploads.length > 0 ? (
                    <div className="rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface-soft)] px-3 py-3 text-sm text-[var(--cp-muted)]">
                      <p className="font-semibold text-[var(--cp-ink)]">What to upload next</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                        {previewStoryboard.recommendedUploads.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {previewStoryboard.assetSummaries.length > 0 ? (
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--cp-ink)]">Asset coverage snapshot</p>
                      <div className="mt-2 grid gap-2 xl:grid-cols-2">
                        {previewStoryboard.assetSummaries.map((asset) => (
                          <div key={asset.assetId} className="rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface-soft)] px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <p className="truncate text-xs font-medium text-[var(--cp-ink)]">{asset.assetPath}</p>
                              <span className="text-[11px] font-semibold text-[var(--cp-muted)]">{asset.bestFitScore}</span>
                            </div>
                            <p className="mt-1 text-xs text-[var(--cp-muted)]">{asset.compactSummary}</p>
                            {asset.analysisMode === "heuristic" && asset.diagnosticMessage ? (
                              <p className="mt-1 text-[11px] text-[var(--cp-warning)]">{asset.diagnosticMessage}</p>
                            ) : null}
                            {asset.topCues.length > 0 ? (
                              <p className="mt-1 text-[11px] text-[var(--cp-muted-dim)]">Signals: {asset.topCues.join(", ")}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <div className="grid gap-4 xl:grid-cols-2">
                {previewStoryboard.beats.map((beat) => (
                  <Card key={beat.beatId} className="min-w-0 border-[var(--cp-border)] py-0 ring-0">
                    <CardContent className="space-y-3 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-[var(--cp-border)] px-2.5 py-1 text-xs font-semibold text-[var(--cp-ink)]">
                          Beat {beat.order}
                        </span>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${coverageTone(beat.coverageLevel)}`}>
                          {beat.coverageLevel}
                        </span>
                        <span className="rounded-full border border-[var(--cp-border)] px-2.5 py-1 text-xs font-medium text-[var(--cp-muted)]">
                          {sourceLabel(beat)}
                        </span>
                        <span className="rounded-full border border-[var(--cp-border)] px-2.5 py-1 text-xs font-medium text-[var(--cp-muted)]">
                          {Math.round(beat.durationSeconds * 10) / 10}s
                        </span>
                      </div>

                      <BeatPreviewFrame beat={beat} format={previewStoryboard.format} />

                      <div>
                        <p className="text-sm font-semibold text-[var(--cp-ink)]">{beat.title}</p>
                        <p className="mt-1 text-xs text-[var(--cp-muted)]">{beat.caption}</p>
                        {beat.titleOverlay ? (
                          <p className="mt-1 text-[11px] text-[var(--cp-muted-dim)]">
                            Title card: {formatSecondsLabel(beat.titleOverlay.startOffsetSeconds)} - {formatSecondsLabel(beat.titleOverlay.endOffsetSeconds)}
                          </p>
                        ) : null}
                      </div>

                      <div className="space-y-1 text-xs text-[var(--cp-muted)]">
                        <p>{beat.matchReason}</p>
                        {beat.subtitleCues && beat.subtitleCues.length > 0 ? (
                          <div className="rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface-soft)] px-3 py-2 text-[11px] text-[var(--cp-muted)]">
                            <p className="font-semibold text-[var(--cp-ink)]">Timed subtitles</p>
                            <div className="mt-2 space-y-1">
                              {beat.subtitleCues.map((cue) => (
                                <p key={cue.cueId}>
                                  <span className="font-medium text-[var(--cp-ink)]">
                                    {formatSecondsLabel(cue.startOffsetSeconds)} - {formatSecondsLabel(cue.endOffsetSeconds)}
                                  </span>{" "}
                                  {cue.text}
                                </p>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {beat.analysisNote ? <p className="text-[11px] text-[var(--cp-warning)]">Analysis note: {beat.analysisNote}</p> : null}
                        {beat.mediaSource === "user" && beat.selectedAssetPath ? (
                          <p className="break-all text-[11px] text-[var(--cp-muted-dim)]">
                            Source: {beat.selectedAssetPath}
                            {timeRange(beat) ? ` · ${timeRange(beat)}` : ""}
                            {beat.cropWindow?.label ? ` · ${beat.cropWindow.label}` : ""}
                          </p>
                        ) : null}
                        {beat.mediaSource === "generated" && beat.generatedVisualPrompt ? (
                          <p className="break-words text-[11px] text-[var(--cp-muted-dim)]">Prompt: {beat.generatedVisualPrompt}</p>
                        ) : null}
                        {beat.generatedAssetPlan ? (
                          <p className="text-[11px] text-[var(--cp-muted-dim)]">
                            Generated asset plan: {beat.generatedAssetPlan.requestedKind}
                            {beat.generatedAssetPlan.degradedFrom ? ` fallback from ${beat.generatedAssetPlan.degradedFrom}` : ""}
                          </p>
                        ) : null}
                        {beat.generatedPreviewPath ? <p className="text-[11px] text-[var(--cp-success)]">Generated preview ready for inspection.</p> : null}
                        {(beat.supportingVisuals?.length ?? 0) > 0 ? (
                          <p className="text-[11px] text-[var(--cp-muted-dim)]">
                            Supporting visuals: {(beat.supportingVisuals ?? []).map((visual) => visual.label).join(", ")}
                          </p>
                        ) : null}
                        {beat.missingCoverageNote ? <p className="text-[11px] text-[var(--cp-warning)]">{beat.missingCoverageNote}</p> : null}
                        {beat.missingCoverageGuidance && beat.missingCoverageGuidance.length > 0 ? (
                          <ul className="list-disc space-y-1 pl-5 text-[11px] text-[var(--cp-muted-dim)]">
                            {beat.missingCoverageGuidance.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
