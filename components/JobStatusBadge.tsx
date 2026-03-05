import type { JobStatus } from "@/lib/types";

const STYLE_MAP: Record<JobStatus, string> = {
  queued: "bg-slate-100 text-slate-700",
  running: "bg-amber-100 text-amber-800",
  complete: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${STYLE_MAP[status]}`}>{status}</span>;
}
