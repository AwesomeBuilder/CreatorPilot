"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandLogo } from "@/components/BrandLogo";

type JobResponse = {
  job: {
    id: string;
    type: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    logs: string[] | null;
    outputJson: unknown;
    renders: Array<{ id: string; variantIndex: number; path: string; duration: number }>;
  };
};

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(`/api/jobs/${params.id}`);
        const payload = (await response.json()) as JobResponse | { error: string };

        if (!response.ok) {
          throw new Error((payload as { error: string }).error ?? "Failed to load job");
        }

        if (!isCancelled) {
          setData(payload as JobResponse);
          setError(null);
        }
      } catch (pollError) {
        if (!isCancelled) {
          setError(pollError instanceof Error ? pollError.message : "Failed to load job");
        }
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), 1500);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [params.id]);

  return (
    <main className="mx-auto min-h-screen max-w-4xl p-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <BrandLogo href="/dashboard" />
          <h1 className="text-2xl font-bold text-[var(--cp-ink)]">Job {params.id}</h1>
        </div>
        <Link href="/dashboard" className="text-sm font-medium text-[var(--cp-link)] underline">
          Back to dashboard
        </Link>
      </header>

      {error ? <p className="rounded bg-[var(--cp-error-bg)] p-2 text-sm text-[var(--cp-error)]">{error}</p> : null}
      {!data ? <p className="text-sm text-[var(--cp-muted-soft)]">Loading job status...</p> : null}

      {data ? (
        <section className="space-y-4 rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-4">
          <div className="grid gap-2 text-sm text-[var(--cp-muted)] md:grid-cols-2">
            <p>
              <strong>Type:</strong> {data.job.type}
            </p>
            <p>
              <strong>Status:</strong> {data.job.status}
            </p>
            <p>
              <strong>Created:</strong> {new Date(data.job.createdAt).toLocaleString()}
            </p>
            <p>
              <strong>Updated:</strong> {new Date(data.job.updatedAt).toLocaleString()}
            </p>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-[var(--cp-ink)]">Logs</h2>
            <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded border border-[var(--cp-border)] bg-[var(--cp-surface-soft)] p-2 text-xs text-[var(--cp-muted)]">
              {(data.job.logs ?? []).join("\n") || "No logs yet"}
            </pre>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-[var(--cp-ink)]">Output</h2>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-[var(--cp-border)] bg-[var(--cp-surface-soft)] p-2 text-xs text-[var(--cp-muted)]">
              {JSON.stringify(data.job.outputJson, null, 2)}
            </pre>
          </div>
        </section>
      ) : null}
    </main>
  );
}
