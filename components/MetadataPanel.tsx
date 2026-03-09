"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Idea, MetadataResult, ScheduleRecommendation, Trend } from "@/lib/types";

type MetadataPanelProps = {
  trend: Trend | null;
  idea: Idea | null;
  metadata: MetadataResult | null;
  schedule: ScheduleRecommendation | null;
  loading: boolean;
  onGenerate: () => void;
};

export function MetadataPanel({ trend, idea, metadata, schedule, loading, onGenerate }: MetadataPanelProps) {
  return (
    <div className="space-y-4">
      <Button
        type="button"
        onClick={onGenerate}
        disabled={loading || !trend || !idea}
        className="text-white"
      >
        {loading ? "Generating..." : "Generate metadata + schedule"}
      </Button>

      {metadata ? (
        <Card className="border-[var(--cp-border)] bg-[var(--cp-surface)] py-0 ring-0">
          <CardContent className="space-y-3 p-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--cp-muted-dim)]">YouTube title</p>
              <p className="text-sm text-[var(--cp-ink)]">{metadata.youtubeTitle}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--cp-muted-dim)]">Description</p>
              <p className="whitespace-pre-wrap text-sm text-[var(--cp-ink-soft)]">{metadata.description}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--cp-muted-dim)]">Hashtags</p>
              <p className="text-sm text-[var(--cp-ink-soft)]">{metadata.hashtags.join(" ")}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--cp-muted-dim)]">Caption variants</p>
              <ul className="list-disc space-y-1 pl-4 text-sm text-[var(--cp-ink-soft)]">
                {metadata.captionVariants.map((caption) => (
                  <li key={caption}>{caption}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {schedule ? (
        <Card className="border-[var(--cp-border)] bg-[var(--cp-surface-soft)] py-0 ring-0">
          <CardContent className="p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--cp-muted-dim)]">Schedule recommendation</p>
            <p className="text-sm text-[var(--cp-ink)]">
              {new Date(schedule.publishAt).toLocaleString()} ({schedule.timezone})
            </p>
            <p className="mt-1 text-xs text-[var(--cp-muted)]">{schedule.reason}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
