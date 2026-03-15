"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Trend } from "@/lib/types";

type TrendPickerProps = {
  trends: Trend[];
  selectedIndex: number;
  onSelect: (index: number) => void;
};

export function TrendPicker({ trends, selectedIndex, onSelect }: TrendPickerProps) {
  if (trends.length === 0) {
    return <p className="text-sm text-[var(--cp-muted-soft)]">No trends yet. Run Fetch trends first.</p>;
  }

  return (
    <div className="space-y-3">
      {trends.map((trend, index) => {
        const selected = index === selectedIndex;
        const popularityScore = trend.popularityScore ?? 0;
        const sourceCount = trend.sourceCount ?? new Set((trend.sourceLinks ?? []).map((entry) => entry.sourceUrl)).size;
        const itemCount = trend.itemCount ?? trend.links.length;
        const sourceLinks = trend.sourceLinks ?? trend.links.map((url) => ({ url, title: url, sourceUrl: url }));
        return (
          <Card
            key={`${trend.trendTitle}-${index}`}
            className={`py-0 ring-0 ${selected ? "border-[var(--cp-primary)] bg-[var(--cp-highlight)]" : "border-[var(--cp-border)] bg-[var(--cp-surface)]"}`}
          >
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-[var(--cp-ink)]">{trend.trendTitle}</h3>
                    <Badge variant="outline" className="border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-[var(--cp-muted)]">
                      Trend score {popularityScore}/100
                    </Badge>
                    {trend.fitLabel ? (
                      <Badge variant="outline" className="border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-[var(--cp-muted)]">
                        {trend.fitLabel}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-[var(--cp-muted)]">{trend.summary}</p>
                  <p className="mt-2 text-xs text-[var(--cp-muted-dim)]">
                    Signals: {itemCount} stories from {sourceCount} sources
                  </p>
                  {trend.fitReason ? <p className="mt-1 text-xs text-[var(--cp-muted-soft)]">{trend.fitReason}</p> : null}
                  <ul className="mt-2 space-y-1">
                    {sourceLinks.map((link) => (
                      <li key={link.url} className="text-xs text-[var(--cp-muted-soft)]">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-[var(--cp-link)] underline underline-offset-2"
                        >
                          {link.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-xs hover:bg-[var(--cp-surface-muted)]"
                  onClick={() => onSelect(index)}
                >
                  {selected ? "Selected" : "Select"}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
