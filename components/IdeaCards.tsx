"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Idea } from "@/lib/types";

type IdeaCardsProps = {
  ideas: Idea[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  emptyText?: string;
};

export function IdeaCards({ ideas, selectedIndex, onSelect, emptyText }: IdeaCardsProps) {
  if (ideas.length === 0) {
    return <p className="text-sm text-[var(--cp-muted-soft)]">{emptyText ?? "No ideas yet. Select a trend and run Generate ideas."}</p>;
  }

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {ideas.map((idea, index) => {
        const selected = selectedIndex === index;
        return (
          <Card
            key={`${idea.videoTitle}-${index}`}
            className={`py-0 ring-0 ${selected ? "border-[var(--cp-primary)] bg-[var(--cp-highlight)]" : "border-[var(--cp-border)] bg-[var(--cp-surface)]"}`}
          >
            <CardContent className="p-3">
              <h3 className="text-sm font-semibold text-[var(--cp-ink)]">{idea.videoTitle}</h3>
              <p className="mt-1 text-xs text-[var(--cp-muted)]">{idea.hook}</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-[var(--cp-muted)]">
                {idea.bulletOutline.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-[var(--cp-muted-soft)]">CTA: {idea.cta}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onSelect(index)}
                className="mt-3 border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-xs hover:bg-[var(--cp-surface-muted)]"
              >
                {selected ? "Selected" : "Select"}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
