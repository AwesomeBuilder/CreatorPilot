"use client";

import { useMemo } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { collectAgentActivity } from "@/lib/agents/logs";
import type { JobStatus } from "@/lib/types";

type AgentActivityPanelProps = {
  logs: string[] | null;
  status?: JobStatus | string | null;
  title?: string;
};

export function AgentActivityPanel({
  logs,
  status,
  title = "Agent Activity",
}: AgentActivityPanelProps) {
  const activity = useMemo(() => collectAgentActivity(logs ?? []), [logs]);

  return (
    <Card className="border-[var(--cp-border)] bg-[var(--cp-surface-soft)] py-0 ring-0">
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[var(--cp-ink)]">{title}</p>
            <p className="text-xs text-[var(--cp-muted)]">
              {activity.length > 0
                ? "Latest control handoffs across the orchestrator and specialist agents."
                : "Waiting for agent-level logs from the active workflow."}
            </p>
          </div>
          {status ? <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--cp-muted)]">{status}</p> : null}
        </div>

        {activity.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {activity.map((item) => (
              <li key={item.agent} className="rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--cp-ink)]">{item.agent}</p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--cp-muted)]">
                    {item.tool ? (
                      <span className="rounded-full border border-[var(--cp-border)] bg-[var(--cp-surface-soft)] px-2 py-0.5">{item.tool}</span>
                    ) : null}
                    {item.timestamp ? <span>{new Date(item.timestamp).toLocaleTimeString()}</span> : null}
                  </div>
                </div>
                <p className="mt-1 text-xs text-[var(--cp-muted)]">{item.message}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-3 text-xs text-[var(--cp-muted)]">
            Agent logs will appear here once the orchestrator starts delegating work.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
