"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { BrandLogo } from "@/components/BrandLogo";
import { IdeaCards } from "@/components/IdeaCards";
import { JobStatusBadge } from "@/components/JobStatusBadge";
import { MetadataPanel } from "@/components/MetadataPanel";
import { RenderPanel } from "@/components/RenderPanel";
import { StepSidebar } from "@/components/StepSidebar";
import { TrendPicker } from "@/components/TrendPicker";
import { UploadPanel } from "@/components/UploadPanel";
import { YoutubePanel } from "@/components/YoutubePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  createdAt?: string;
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
  const [jobHistory, setJobHistory] = useState<Array<{ id: string; type: string; status: JobRecord["status"]; createdAt?: string }>>(
    [],
  );

  const [activeJob, setActiveJob] = useState<{ id: string; type: string; status: JobRecord["status"] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMetadataLoading, setIsMetadataLoading] = useState(false);
  const [isYoutubeStarting, setIsYoutubeStarting] = useState(false);
  const [isAutopilotRunning, setIsAutopilotRunning] = useState(false);

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
      setError(
        "YouTube OAuth failed. If Google shows 'app hasn't been verified', set OAuth app to Testing, add your Google account as a test user, then retry and continue via Advanced.",
      );
    }
  }, []);

  const rememberJob = (job: JobRecord, fallbackType?: string) => {
    const type = fallbackType ?? job.type;
    setJobHistory((current) => {
      const withoutCurrent = current.filter((item) => item.id !== job.id);
      return [{ id: job.id, type, status: job.status, createdAt: job.createdAt }, ...withoutCurrent].slice(0, 12);
    });
  };

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
        rememberJob(job, type);
        setActiveJob({ id: job.id, type, status: "complete" });
        return job;
      }

      if (job.status === "failed") {
        rememberJob(job, type);
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
      const fetchedTrends = output?.trends ?? [];

      setTrends(fetchedTrends);
      setSelectedTrendIndex(0);
      setIdeas([]);
      setMetadata(null);
      setSchedule(null);
      setMessage(`Fetched ${fetchedTrends.length} trend clusters.`);
      setActiveStep(1);
      return fetchedTrends;
    } catch (jobError) {
      setError(jobError instanceof Error ? jobError.message : "Trend detection failed");
      return null;
    }
  };

  const runIdeas = async (trendOverride?: Trend) => {
    const trendForIdeas = trendOverride ?? selectedTrend;

    if (!trendForIdeas) {
      setError("Select a trend first.");
      return null;
    }

    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trend: trendForIdeas }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to start ideas job");
      }

      const completed = await waitForJob(data.jobId, "ideas");
      const output = completed.outputJson as { ideas?: Idea[] };
      const generatedIdeas = output.ideas ?? [];

      setIdeas(generatedIdeas);
      setSelectedIdeaIndex(0);
      setMetadata(null);
      setSchedule(null);
      setMessage(`Generated ${generatedIdeas.length} idea candidates.`);
      setActiveStep(2);
      return generatedIdeas;
    } catch (jobError) {
      setError(jobError instanceof Error ? jobError.message : "Idea generation failed");
      return null;
    }
  };

  const startRenderJob = async (payload: { idea: Idea; mediaAssetIds: string[]; preference: "auto" | "shorts" | "landscape" }) => {
    const response = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? "Render failed to start");
    }

    return data.jobId as string;
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

  const generateMetadataAndSchedule = async (params?: { trend?: Trend; idea?: Idea; advanceStep?: boolean }) => {
    const trendForMetadata = params?.trend ?? selectedTrend;
    const ideaForMetadata = params?.idea ?? selectedIdea;
    const shouldAdvance = params?.advanceStep ?? true;

    if (!trendForMetadata || !ideaForMetadata) {
      setError("Select trend and idea first.");
      return null;
    }

    setIsMetadataLoading(true);
    setError(null);

    try {
      const [metadataRes, scheduleRes] = await Promise.all([
        fetch("/api/metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trend: trendForMetadata, idea: ideaForMetadata }),
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
      if (shouldAdvance) {
        setActiveStep(6);
      }
      return { metadata: metadataData.metadata as MetadataResult, schedule: scheduleData.schedule as ScheduleRecommendation };
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Metadata generation failed");
      return null;
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

  const startYoutubeUpload = async (payload: { renderId: string; publishAt?: string; metadataOverride?: MetadataResult }) => {
    const metadataForUpload = payload.metadataOverride ?? metadata;

    if (!metadataForUpload) {
      setError("Generate metadata first.");
      return null;
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
          title: metadataForUpload.youtubeTitle,
          description: `${metadataForUpload.description}\n\n${metadataForUpload.hashtags.join(" ")}`,
          tags: metadataForUpload.tags,
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
      return completed;
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "YouTube upload failed");
      return null;
    } finally {
      setIsYoutubeStarting(false);
    }
  };

  const runAutopilot = async () => {
    if (isAutopilotRunning) {
      return;
    }

    setIsAutopilotRunning(true);
    setError(null);
    setMessage("Autopilot started.");

    try {
      const fetchedTrends = await runTrends();
      const trendForPipeline = fetchedTrends?.[0] ?? null;

      if (!trendForPipeline) {
        setActiveStep(1);
        setMessage("Autopilot stopped: no trends were found.");
        return;
      }

      const generatedIdeas = await runIdeas(trendForPipeline);
      const ideaForPipeline = generatedIdeas?.[0] ?? null;

      if (!ideaForPipeline) {
        setActiveStep(2);
        setMessage("Autopilot stopped: no ideas were generated.");
        return;
      }

      if (assets.length === 0) {
        setActiveStep(3);
        setMessage("Autopilot paused at Upload media. Add at least one asset to continue.");
        return;
      }

      setMessage("Autopilot running render...");
      const renderJobId = await startRenderJob({
        idea: ideaForPipeline,
        mediaAssetIds: assets.map((asset) => asset.id),
        preference: "auto",
      });

      const completedRender = await waitForJob(renderJobId, "render");
      setLatestRenderJob(completedRender);

      const metadataResult = await generateMetadataAndSchedule({
        trend: trendForPipeline,
        idea: ideaForPipeline,
        advanceStep: false,
      });

      if (!metadataResult) {
        setActiveStep(5);
        return;
      }

      const defaultVariantId = completedRender.renders?.[0]?.id;
      if (!defaultVariantId) {
        setActiveStep(6);
        setMessage("Autopilot completed through metadata. No render variant available to upload.");
        return;
      }

      const youtubeJob = await startYoutubeUpload({
        renderId: defaultVariantId,
        publishAt: metadataResult.schedule.publishAt,
        metadataOverride: metadataResult.metadata,
      });

      if (!youtubeJob) {
        setActiveStep(6);
        return;
      }

      setActiveStep(6);
      setMessage("Autopilot completed all available steps.");
    } catch (autopilotError) {
      setError(autopilotError instanceof Error ? autopilotError.message : "Autopilot failed");
    } finally {
      setIsAutopilotRunning(false);
    }
  };

  const renderStepContent = () => {
    switch (activeStep) {
      case 0:
        return (
          <section className="space-y-3">
            <p className="text-sm text-[var(--cp-muted)]">
              Fetch RSS feeds, cluster stories into up to 3 trend groups, then continue to idea generation.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={runAutopilot}
                disabled={isAutopilotRunning || isYoutubeStarting || isMetadataLoading}
                className="bg-[var(--cp-deep)] text-white hover:bg-[var(--cp-deep)]/90"
              >
                {isAutopilotRunning ? "Executing..." : "Execute pipeline (auto)"}
              </Button>
              <Button
                type="button"
                onClick={runTrends}
                className="text-white"
              >
                Fetch trends
              </Button>
            </div>
            <p className="text-xs text-[var(--cp-muted-dim)]">
              Autopilot uses top-ranked trend and idea by default, then pauses if media is missing.
            </p>
            <p className="text-xs text-[var(--cp-muted-dim)]">Sources configured: {profile?.sources.length ?? 0}</p>
          </section>
        );
      case 1:
        return (
          <section className="space-y-3">
            <TrendPicker trends={trends} selectedIndex={selectedTrendIndex} onSelect={setSelectedTrendIndex} />
            <Button
              type="button"
              onClick={() => setActiveStep(2)}
              disabled={trends.length === 0}
              variant="outline"
              className="border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-[var(--cp-ink-soft)] hover:bg-[var(--cp-surface-muted)]"
            >
              Continue to ideas
            </Button>
          </section>
        );
      case 2:
        return (
          <section className="space-y-3">
            <p className="text-sm text-[var(--cp-muted)]">Generate three creator-ready ideas from the selected trend.</p>
            <Button
              type="button"
              onClick={() => {
                void runIdeas();
              }}
              disabled={!selectedTrend}
              className="text-white"
            >
              Generate ideas
            </Button>
            <IdeaCards ideas={ideas} selectedIndex={selectedIdeaIndex} onSelect={setSelectedIdeaIndex} />
            <Button
              type="button"
              onClick={() => setActiveStep(3)}
              disabled={!selectedIdea || ideas.length === 0}
              variant="outline"
              className="border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-[var(--cp-ink-soft)] hover:bg-[var(--cp-surface-muted)]"
            >
              Continue to media
            </Button>
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
            <Button
              type="button"
              onClick={() => setActiveStep(4)}
              disabled={assets.length === 0 || !selectedIdea}
              variant="outline"
              className="border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-[var(--cp-ink-soft)] hover:bg-[var(--cp-surface-muted)]"
            >
              Continue to render
            </Button>
          </section>
        );
      case 4:
        return (
          <section className="space-y-3">
            <RenderPanel idea={selectedIdea} assets={assets} onJobCreated={handleRenderJobCreated} />
            {latestRenderJob?.status === "complete" ? (
              <p className="text-sm text-[var(--cp-success)]">Last render complete. You can proceed to metadata.</p>
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
        <div className="space-y-2">
          <BrandLogo href="/dashboard" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--cp-ink)]">Creator Pilot Dashboard</h1>
            <p className="text-sm text-[var(--cp-muted-soft)]">
              End-to-end pipeline: trends → ideas → media → render → metadata → schedule → YouTube upload.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={runAutopilot}
            disabled={isAutopilotRunning || isYoutubeStarting || isMetadataLoading}
            className="bg-[var(--cp-deep)] text-white hover:bg-[var(--cp-deep)]/90"
          >
            {isAutopilotRunning ? "Executing..." : "Execute pipeline"}
          </Button>
          <Link href="/onboarding" className="text-sm font-medium text-[var(--cp-link)] underline">
            Edit onboarding
          </Link>
          {activeJob ? (
            <Card size="sm" className="border-[var(--cp-border)] bg-[var(--cp-surface)] py-0 ring-0">
              <CardContent className="px-3 py-2 text-xs">
                <span className="mr-2 font-medium text-[var(--cp-muted)]">Job {activeJob.type}</span>
                <JobStatusBadge status={activeJob.status} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <StepSidebar steps={STEPS} activeStep={activeStep} onSelect={setActiveStep} />

        <Card className="border-[var(--cp-border)] bg-[var(--cp-surface)] py-0 shadow-sm ring-0">
          <CardContent className="p-4">
            {message ? <p className="mb-3 rounded-md bg-[var(--cp-success-bg)] p-2 text-sm text-[var(--cp-success)]">{message}</p> : null}
            {error ? <p className="mb-3 rounded-md bg-[var(--cp-error-bg)] p-2 text-sm text-[var(--cp-error)]">{error}</p> : null}
            {renderStepContent()}

            {latestYoutubeJob ? (
              <Card className="mt-6 border-[var(--cp-border)] bg-[var(--cp-surface-soft)] py-0 ring-0">
                <CardContent className="p-3">
                  <p className="text-sm font-semibold text-[var(--cp-ink)]">Last YouTube upload job</p>
                  <p className="text-xs text-[var(--cp-muted)]">Status: {latestYoutubeJob.status}</p>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-[var(--cp-surface)] p-2 text-xs text-[var(--cp-muted)]">
                    {JSON.stringify(latestYoutubeJob.outputJson, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            ) : null}

            {jobHistory.length > 0 ? (
              <Card className="mt-6 border-[var(--cp-border)] bg-[var(--cp-surface-soft)] py-0 ring-0">
                <CardContent className="p-3">
                  <p className="text-sm font-semibold text-[var(--cp-ink)]">Recent run history</p>
                  <ul className="mt-2 space-y-2">
                    {jobHistory.map((job) => (
                      <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-[var(--cp-surface)] px-2 py-1">
                        <div className="flex items-center gap-2 text-xs text-[var(--cp-muted)]">
                          <span className="font-medium">{job.type}</span>
                          <JobStatusBadge status={job.status} />
                          <span>{job.createdAt ? new Date(job.createdAt).toLocaleString() : "Unknown time"}</span>
                        </div>
                        <Link href={`/jobs/${job.id}`} className="text-xs font-medium text-[var(--cp-link)] underline">
                          Open job
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
