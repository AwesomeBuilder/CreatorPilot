"use client";

import type { Trend } from "@/lib/types";

type TrendPickerProps = {
  trends: Trend[];
  selectedIndex: number;
  onSelect: (index: number) => void;
};

export function TrendPicker({ trends, selectedIndex, onSelect }: TrendPickerProps) {
  if (trends.length === 0) {
    return <p className="text-sm text-slate-600">No trends yet. Run Fetch trends first.</p>;
  }

  return (
    <div className="space-y-3">
      {trends.map((trend, index) => {
        const selected = index === selectedIndex;
        return (
          <article
            key={`${trend.trendTitle}-${index}`}
            className={`rounded-lg border p-3 ${selected ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{trend.trendTitle}</h3>
                <p className="mt-1 text-sm text-slate-700">{trend.summary}</p>
                <p className="mt-2 text-xs text-slate-500">Links: {trend.links.length}</p>
              </div>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100"
                onClick={() => onSelect(index)}
              >
                {selected ? "Selected" : "Select"}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
