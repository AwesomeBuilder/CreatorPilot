"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type StepSidebarProps = {
  steps: string[];
  activeStep: number;
  onSelect: (step: number) => void;
};

export function StepSidebar({ steps, activeStep, onSelect }: StepSidebarProps) {
  return (
    <Card className="border-[var(--cp-border)] bg-[var(--cp-surface)] py-0 shadow-sm ring-0">
      <CardContent className="p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--cp-muted-dim)]">Workflow</h2>
        <ol className="space-y-2">
          {steps.map((step, index) => {
            const isActive = activeStep === index;

            return (
              <li key={step}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onSelect(index)}
                  className={`h-auto w-full justify-start rounded-lg border px-3 py-2 text-left text-sm font-normal transition ${
                    isActive
                      ? "border-[var(--cp-primary)] bg-[var(--cp-highlight)] text-[var(--cp-deep)] hover:bg-[var(--cp-highlight)]"
                      : "border-[var(--cp-border)] bg-[var(--cp-surface-soft)] text-[var(--cp-muted)] hover:bg-[var(--cp-surface-muted)]"
                  }`}
                >
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs font-semibold">
                    {index + 1}
                  </span>
                  {step}
                </Button>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
