"use client";

import type { Idea } from "@/lib/types";

type IdeaCardsProps = {
  ideas: Idea[];
  selectedIndex: number;
  onSelect: (index: number) => void;
};

export function IdeaCards({ ideas, selectedIndex, onSelect }: IdeaCardsProps) {
  if (ideas.length === 0) {
    return <p className="text-sm text-slate-600">No ideas yet. Select a trend and run Generate ideas.</p>;
  }

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {ideas.map((idea, index) => {
        const selected = selectedIndex === index;
        return (
          <article
            key={`${idea.videoTitle}-${index}`}
            className={`rounded-lg border p-3 ${selected ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"}`}
          >
            <h3 className="text-sm font-semibold text-slate-900">{idea.videoTitle}</h3>
            <p className="mt-1 text-xs text-slate-700">{idea.hook}</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700">
              {idea.bulletOutline.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-600">CTA: {idea.cta}</p>
            <button
              type="button"
              onClick={() => onSelect(index)}
              className="mt-3 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100"
            >
              {selected ? "Selected" : "Select"}
            </button>
          </article>
        );
      })}
    </div>
  );
}
