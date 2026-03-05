"use client";

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
      <button
        type="button"
        onClick={onGenerate}
        disabled={loading || !trend || !idea}
        className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? "Generating..." : "Generate metadata + schedule"}
      </button>

      {metadata ? (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">YouTube title</p>
            <p className="text-sm text-slate-900">{metadata.youtubeTitle}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</p>
            <p className="whitespace-pre-wrap text-sm text-slate-800">{metadata.description}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hashtags</p>
            <p className="text-sm text-slate-800">{metadata.hashtags.join(" ")}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Caption variants</p>
            <ul className="list-disc space-y-1 pl-4 text-sm text-slate-800">
              {metadata.captionVariants.map((caption) => (
                <li key={caption}>{caption}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {schedule ? (
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Schedule recommendation</p>
          <p className="text-sm text-slate-900">
            {new Date(schedule.publishAt).toLocaleString()} ({schedule.timezone})
          </p>
          <p className="mt-1 text-xs text-slate-700">{schedule.reason}</p>
        </section>
      ) : null}
    </div>
  );
}
