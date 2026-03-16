"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  const selectedVariant = variants.find((variant) => variant.id === effectiveRenderId) ?? null;

  const canUpload = useMemo(
    () => Boolean(metadata && effectiveRenderId && variants.length > 0 && selectedVariant?.hasAudio !== false),
    [metadata, effectiveRenderId, selectedVariant?.hasAudio, variants.length],
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
                <p className="truncate text-[11px] text-[var(--cp-muted)]">{selectedVariant.path}</p>
              </div>
              <video
                key={selectedVariant.id}
                controls
                preload="metadata"
                className="w-full rounded-lg border border-[var(--cp-border)] bg-black"
                src={selectedVariant.previewUrl}
              />
              <p className={`text-[11px] ${selectedVariant.hasAudio === false ? "text-[var(--cp-error)]" : "text-[var(--cp-muted)]"}`}>
                Audio: {selectedVariant.hasAudio === false ? "missing" : audioStatus === "generated" ? "generated narration included" : "available or unknown"}
              </p>
            </div>
          ) : null}

          {audioStatus === "missing" || selectedVariant?.hasAudio === false ? (
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
