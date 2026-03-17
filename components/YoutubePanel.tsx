"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RenderAudioComposition } from "@/lib/types";

type YoutubeStatus = {
  connected: boolean;
  mode: "mock" | "live";
  reason: string;
};

type RenderVariantOption = {
  id: string;
  label: string;
  path: string;
  previewUrl: string;
  hasAudio?: boolean;
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
  audioStatus: "generated" | "missing" | null;
  audioError: string | null;
  audioComposition: RenderAudioComposition | null;
  onConnect: () => void;
  onUpload: (payload: { renderId: string; publishAt?: string }) => void;
  isUploading: boolean;
};

export function YoutubePanel({
  status,
  metadata,
  schedule,
  variants,
  audioStatus,
  audioError,
  audioComposition,
  onConnect,
  onUpload,
  isUploading,
}: YoutubePanelProps) {
  const defaultVariant = variants[0]?.id ?? "";
  const [selectedRenderId, setSelectedRenderId] = useState(defaultVariant);
  const [useSchedule, setUseSchedule] = useState(true);
  const [previewErrorVariantId, setPreviewErrorVariantId] = useState<string | null>(null);

  const effectiveRenderId = variants.some((variant) => variant.id === selectedRenderId)
    ? selectedRenderId
    : defaultVariant;
  const selectedVariant = variants.find((variant) => variant.id === effectiveRenderId) ?? null;
  const renderHasAudio = audioStatus === "generated" || selectedVariant?.hasAudio !== false;
  const previewError = previewErrorVariantId === selectedVariant?.id;

  const canUpload = useMemo(
    () => Boolean(metadata && effectiveRenderId && variants.length > 0 && renderHasAudio),
    [metadata, effectiveRenderId, renderHasAudio, variants.length],
  );

  return (
    <div className="space-y-4">
      <Card className="border-[var(--cp-border)] py-0 ring-0">
        <CardContent className="p-3">
          <p className="text-sm font-semibold text-[var(--cp-ink)]">YouTube connection</p>
          <p className="text-xs text-[var(--cp-muted)]">
            Mode: <strong>{status?.mode ?? "unknown"}</strong> - {status?.reason ?? "Status unavailable"}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={onConnect}
            className="mt-2 border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-[var(--cp-ink-soft)] hover:bg-[var(--cp-surface-muted)]"
          >
            Connect YouTube
          </Button>
        </CardContent>
      </Card>

      <Card className="border-[var(--cp-border)] py-0 ring-0">
        <CardContent className="p-3">
          <p className="text-sm font-semibold text-[var(--cp-ink)]">Upload render</p>
          <Label htmlFor="variant-select" className="mb-1 mt-2 block text-xs font-medium text-[var(--cp-muted)]">
            Variant
          </Label>
          <Select
            value={effectiveRenderId}
            onValueChange={setSelectedRenderId}
          >
            <SelectTrigger
              id="variant-select"
              className="w-full border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-sm text-[var(--cp-ink-soft)]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {variants.map((variant) => (
                <SelectItem key={variant.id} value={variant.id}>
                  {variant.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="mt-3 flex items-center gap-2 text-xs text-[var(--cp-muted)]">
            <Checkbox
              id="apply-schedule"
              checked={useSchedule}
              onCheckedChange={(checked) => setUseSchedule(checked === true)}
              disabled={!schedule}
              className="border-[var(--cp-border-strong)]"
            />
            <Label htmlFor="apply-schedule" className="text-xs font-normal text-[var(--cp-muted)]">
              Apply recommended schedule (best effort)
            </Label>
          </div>
          {!status || status.mode === "mock" ? (
            <p className="mt-2 text-xs text-[var(--cp-warning)]">Currently in mock mode. Upload call will be simulated.</p>
          ) : null}

          {selectedVariant ? (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-[var(--cp-ink)]">Preview selected render</p>
                <div className="flex items-center gap-3">
                  <p className="truncate text-[11px] text-[var(--cp-muted)]">{selectedVariant.path}</p>
                  <a
                    href={selectedVariant.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-[11px] font-medium text-[var(--cp-link)] underline"
                  >
                    Open render
                  </a>
                </div>
              </div>
              <video
                key={selectedVariant.id}
                controls
                preload="metadata"
                className="w-full rounded-lg border border-[var(--cp-border)] bg-black"
                src={selectedVariant.previewUrl}
                onError={() =>
                  setPreviewErrorVariantId(selectedVariant.id)
                }
                onLoadedData={() => setPreviewErrorVariantId(null)}
              />
              {previewError ? (
                <p className="text-[11px] text-[var(--cp-error)]">
                  Preview unavailable. This render may have expired, been deleted, or been created before persistent storage was enabled.
                </p>
              ) : null}
              <p className={`text-[11px] ${renderHasAudio ? "text-[var(--cp-muted)]" : "text-[var(--cp-error)]"}`}>
                Audio: {audioStatus === "generated" ? "generated narration included" : renderHasAudio ? "available or unknown" : "missing"}
              </p>
              {audioComposition ? (
                <div className="rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface-soft)] px-3 py-3 text-[11px] text-[var(--cp-muted)]">
                  <p className="font-medium text-[var(--cp-ink)]">Audio composition</p>
                  <p className="mt-1">{audioComposition.summary}</p>
                  <p className="mt-2">
                    Narration: {audioComposition.narration.status} · {audioComposition.narration.spokenSegmentCount}/{audioComposition.narration.beatCount} beats voiced
                  </p>
                  <p>
                    Music: {audioComposition.backgroundMusic.status}
                    {audioComposition.backgroundMusic.sourcePath ? ` · ${audioComposition.backgroundMusic.sourcePath}` : ""}
                  </p>
                  <p>
                    Transition SFX: {audioComposition.transitionSfx.status}
                    {audioComposition.transitionSfx.eventCount ? ` · ${audioComposition.transitionSfx.eventCount} hit${audioComposition.transitionSfx.eventCount === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {audioStatus === "missing" || !renderHasAudio ? (
            <p className="mt-2 text-xs text-[var(--cp-error)]">
              This render cannot be uploaded to YouTube until narration/audio is present.
              {audioError ? ` ${audioError}` : ""}
            </p>
          ) : null}

          <Button
            type="button"
            disabled={!canUpload || isUploading}
            onClick={() => onUpload({ renderId: effectiveRenderId, publishAt: useSchedule ? schedule?.publishAt : undefined })}
            className="mt-3 text-white"
          >
            {isUploading ? "Starting upload..." : "Upload to YouTube (private)"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
