import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "@/lib/types";

const STYLE_MAP: Record<JobStatus, string> = {
  queued: "border-transparent bg-[var(--cp-surface-muted)] text-[var(--cp-muted)]",
  running: "border-transparent bg-[var(--cp-warning-bg)] text-[var(--cp-warning-strong)]",
  complete: "border-transparent bg-[var(--cp-success-bg)] text-[var(--cp-success-strong)]",
  failed: "border-transparent bg-[var(--cp-error-bg)] text-[var(--cp-error-strong)]",
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <Badge variant="outline" className={STYLE_MAP[status]}>
      {status}
    </Badge>
  );
}
