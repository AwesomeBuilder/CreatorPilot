"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { IdeaCards } from "@/components/IdeaCards";
import { JobStatusBadge } from "@/components/JobStatusBadge";
import { MetadataPanel } from "@/components/MetadataPanel";
import { RenderPanel } from "@/components/RenderPanel";
import { StepSidebar } from "@/components/StepSidebar";
import { TrendPicker } from "@/components/TrendPicker";
import { UploadPanel } from "@/components/UploadPanel";
import { YoutubePanel } from "@/components/YoutubePanel";
import type { Idea, MetadataResult, ScheduleRecommendation, Trend } from "@/lib/types";

type ProfilePayload = {
  user: {
    id: string;
    niche: string | null;
    tone: string | null;
    timezone: string;
  };
  sources: Array<{ id: string; url: string; enabled: boolean }>;
  youtube: {
    connected: boolean;
    mode: "mock" | "live";
    reason: string;
  };
};

type MediaAsset = {
  id: string;
  path: string;
  type: string;
};

type JobRecord = {
  id: string;
  type: string;
  status: "queued" | "running" | "complete" | "failed";
  logs: string[] | null;
  outputJson: unknown;
  renders?: Array<{ id: string; variantIndex: number; path: string; duration: number }>;
};

const STEPS = [
  "Fetch trends",
  "Select trend",
  "Generate ideas",
  "Upload media",
  "Render video",
  "Generate metadata",
  "Upload to YouTube",
];

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function DashboardPage() {
  const [activeStep, setActiveStep] = useState(0);
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]);

  const [trends, setTrends] = useState<Trend[]>([]);
  const [selectedTrendIndex, setSelectedTrendIndex] = useState(0);

  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [selectedIdeaIndex, setSelectedIdeaIndex] = useState(0);

  const [metadata, setMetadata] = useState<MetadataResult | null>(null);
  const [schedule, setSchedule] = useState<ScheduleRecommendation | null>(null);

  const [latestRenderJob, setLatestRenderJob] = useState<JobRecord | null>(null);
  const [latestYoutubeJob, setLatestYoutubeJob] = useState<JobRecord | null>(null);

  const [activeJob, setActiveJob] = useState<{ id: string; type: string; status: JobRecord["status"] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMetadataLoading, setIsMetadataLoading] = useState(false);
  const [isYoutubeStarting, setIsYoutubeStarting] = useState(false);

  const selectedTrend = trends[selectedTrendIndex] ?? null;
  const selectedIdea = ideas[selectedIdeaIndex] ?? null;

  const renderVariantOptions = useMemo(() => {
    return (latestRenderJob?.renders ?? []).map((render) => ({
      id: render.id,
      label: `Variant ${render.variantIndex} (${render.duration}s)`,
      path: render.path,
    }));
  }, [latestRenderJob?.renders]);

  const loadProfile = async () => {
    const response = await fetch("/api/profile");
    const data = (await response.json()) as ProfilePayload;
    setProfile(data);
  };

  const loadAssets = async () => {
    const response = await fetch("/api/media");
    const data = await response.json();
    setAssets(data.assets ?? []);
  };

  useEffect(() => {
    void loadProfile();
    void loadAssets();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const youtubeParam = params.get("youtube");
    if (youtubeParam === "connected") {
      setMessage("YouTube connected successfully.");
      void loadProfile();
    }

    if (youtubeParam === "oauth_error") {
      setError("YouTube OAuth failed. Check Google OAuth settings and try again.");
    }
  }, []);

  const waitForJob = async (jobId: string, type: string) => {
    for (let attempts = 0; attempts < 180; attempts += 1) {
      const response = await fetch(`/api/jobs/${jobId}`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to fetch job status");
      }

      const job = payload.job as JobRecord;
      setActiveJob({ id: job.id, type, status: job.status });

      if (job.status === "complete") {
        setActiveJob({ id: job.id, type, status: "complete" });
        return job;
      }

      if (job.status === "failed") {
        setActiveJob({ id: job.id, type, status: "failed" });
        const logs = Array.isArray(job.logs) ? job.logs : [];
        throw new Error(logs.at(-1) ?? "Job failed");
      }

      await sleep(1500);
    }

    throw new Error("Job timeout");
  };

  const runTrends = async () => {
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/trends", { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to start trends job");
      }

      const completed = await waitForJob(data.jobId, "trends");
      const output = completed.outputJson as { trends?: Trend[] };

      setTrends(output?.trends ?? []);
      setSelectedTrendIndex(0);
      setIdeas([]);
      setMetadata(null);
      setSchedule(null);
      setMessage(`Fetched ${(output?.trends ?? []).length} trend clusters.`);
      setActiveStep(1);
    } catch (jobError) {
      setError(jobError instanceof Error ? jobError.message : "Trend detection failed");
    }
  };

  const runIdeas = async () => {
    if (!selectedTrend) {
      setError("Select a trend first.");
      return;
    }

    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trend: selectedTrend }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to start ideas job");
      }

      const completed = await waitForJob(data.jobId, "ideas");
      const output = completed.outputJson as { ideas?: Idea[] };

      setIdeas(output.ideas ?? []);
      setSelectedIdeaIndex(0);
      setMetadata(null);
      setSchedule(null);
      setMessage("Generated 3 idea candidates.");
      setActiveStep(3);
    } catch (jobError) {
      setError(jobError instanceof Error ? jobError.message : "Idea generation failed");
    }
  };

  const handleRenderJobCreated = async (jobId: string) => {
    setError(null);
    setMessage("Render job started.");

    try {
      const completed = await waitForJob(jobId, "render");
      setLatestRenderJob(completed);
      setMessage("Rendering complete. 3 variants generated.");
      setActiveStep(5);
    } catch (jobError) {
      setError(jobError instanceof Error ? jobError.message : "Render job failed");
    }
  };

  const generateMetadataAndSchedule = async () => {
    if (!selectedTrend || !selectedIdea) {
      setError("Select trend and idea first.");
      return;
    }

    setIsMetadataLoading(true);
    setError(null);

    try {
      const [metadataRes, scheduleRes] = await Promise.all([
        fetch("/api/metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trend: selectedTrend, idea: selectedIdea }),
        }),
        fetch("/api/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timezone: profile?.user.timezone }),
        }),
      ]);

      const metadataData = await metadataRes.json();
      const scheduleData = await scheduleRes.json();

      if (!metadataRes.ok) {
        throw new Error(metadataData.error ?? "Metadata generation failed");
      }

      if (!scheduleRes.ok) {
        throw new Error(scheduleData.error ?? "Schedule generation failed");
      }

      setMetadata(metadataData.metadata);
      setSchedule(scheduleData.schedule);
      setMessage("Metadata and scheduling recommendation generated.");
      setActiveStep(6);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Metadata generation failed");
    } finally {
      setIsMetadataLoading(false);
    }
  };

  const connectYouTube = async () => {
    setError(null);
    setMessage(null);

    const response = await fetch("/api/youtube?action=auth-url");
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "Failed to get YouTube auth URL");
      return;
    }

    if (data.authUrl) {
      window.location.href = data.authUrl;
      return;
    }

    setMessage(`Using mock mode: ${data.status?.reason ?? "No OAuth configuration"}`);
    setProfile((current) => (current ? { ...current, youtube: data.status } : current));
  };

  const startYoutubeUpload = async (payload: { renderId: string; publishAt?: string }) => {
    if (!metadata) {
      setError("Generate metadata first.");
      return;
    }

    setIsYoutubeStarting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renderId: payload.renderId,
          title: metadata.youtubeTitle,
          description: `${metadata.description}\n\n${metadata.hashtags.join(" ")}`,
          tags: metadata.tags,
          publishAt: payload.publishAt,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to start YouTube upload");
      }

      const completed = await waitForJob(data.jobId, "youtube-upload");
      setLatestYoutubeJob(completed);

      const output = completed.outputJson as { mode?: "mock" | "live"; videoId?: string; url?: string; scheduleNote?: string };
      const label = output.mode === "mock" ? "Mock upload finished." : "YouTube upload complete.";
      const target = output.url ? ` Link: ${output.url}` : output.videoId ? ` Video ID: ${output.videoId}` : "";
      const note = output.scheduleNote ? ` ${output.scheduleNote}` : "";

      setMessage(`${label}${target}${note}`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "YouTube upload failed");
    } finally {
      setIsYoutubeStarting(false);
    }
  };

  const renderStepContent = () => {
    switch (activeStep) {
      case 0:
        return (
          <section className="space-y-3">
            <p className="text-sm text-slate-700">
              Fetch RSS feeds, cluster stories into up to 3 trend groups, then continue to idea generation.
            </p>
            <button
              type="button"
              onClick={runTrends}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white"
            >
              Fetch trends
            </button>
            <p className="text-xs text-slate-500">Sources configured: {profile?.sources.length ?? 0}</p>
          </section>
        );
      case 1:
        return (
          <section className="space-y-3">
            <TrendPicker trends={trends} selectedIndex={selectedTrendIndex} onSelect={setSelectedTrendIndex} />
            <button
              type="button"
              onClick={() => setActiveStep(2)}
              disabled={trends.length === 0}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              Continue to ideas
            </button>
          </section>
        );
      case 2:
        return (
          <section className="space-y-3">
            <p className="text-sm text-slate-700">Generate three creator-ready ideas from the selected trend.</p>
            <button
              type="button"
              onClick={runIdeas}
              disabled={!selectedTrend}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Generate ideas
            </button>
            <IdeaCards ideas={ideas} selectedIndex={selectedIdeaIndex} onSelect={setSelectedIdeaIndex} />
          </section>
        );
      case 3:
        return (
          <section className="space-y-3">
            <UploadPanel
              assets={assets}
              onUploaded={(uploadedAssets) => {
                setAssets((current) => [...uploadedAssets, ...current]);
                setMessage(`Uploaded ${uploadedAssets.length} media assets.`);
              }}
            />
            <button
              type="button"
              onClick={() => setActiveStep(4)}
              disabled={assets.length === 0}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              Continue to render
            </button>
          </section>
        );
      case 4:
        return (
          <section className="space-y-3">
            <RenderPanel idea={selectedIdea} assets={assets} onJobCreated={handleRenderJobCreated} />
            {latestRenderJob?.status === "complete" ? (
              <p className="text-sm text-emerald-700">Last render complete. You can proceed to metadata.</p>
            ) : null}
          </section>
        );
      case 5:
        return (
          <MetadataPanel
            trend={selectedTrend}
            idea={selectedIdea}
            metadata={metadata}
            schedule={schedule}
            loading={isMetadataLoading}
            onGenerate={generateMetadataAndSchedule}
          />
        );
      case 6:
        return (
          <YoutubePanel
            status={profile?.youtube ?? null}
            metadata={
              metadata
                ? {
                    youtubeTitle: metadata.youtubeTitle,
                    description: metadata.description,
                    tags: metadata.tags,
                  }
                : null
            }
            schedule={schedule ? { publishAt: schedule.publishAt } : null}
            variants={renderVariantOptions}
            onConnect={connectYouTube}
            onUpload={startYoutubeUpload}
            isUploading={isYoutubeStarting}
          />
        );
      default:
        return null;
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">InfluencePilot Dashboard</h1>
          <p className="text-sm text-slate-600">
            End-to-end pipeline: trends → ideas → media → render → metadata → schedule → YouTube upload.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/onboarding" className="text-sm font-medium text-blue-700 underline">
            Edit onboarding
          </Link>
          {activeJob ? (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
              <span className="mr-2 font-medium text-slate-700">Job {activeJob.type}</span>
              <JobStatusBadge status={activeJob.status} />
            </div>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <StepSidebar steps={STEPS} activeStep={activeStep} onSelect={setActiveStep} />

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {message ? <p className="mb-3 rounded-md bg-emerald-50 p-2 text-sm text-emerald-700">{message}</p> : null}
          {error ? <p className="mb-3 rounded-md bg-rose-50 p-2 text-sm text-rose-700">{error}</p> : null}
          {renderStepContent()}

          {latestYoutubeJob ? (
            <section className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Last YouTube upload job</p>
              <p className="text-xs text-slate-700">Status: {latestYoutubeJob.status}</p>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-xs text-slate-700">
                {JSON.stringify(latestYoutubeJob.outputJson, null, 2)}
              </pre>
            </section>
          ) : null}
        </section>
      </div>
    </main>
  );
}
