"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SearchIcon, UploadIcon, XIcon } from "lucide-react";

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
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { findMatchingCuratedPreset } from "@/lib/default-sources";
import type { Idea, MetadataResult, ScheduleRecommendation, StoryboardPlan, Trend } from "@/lib/types";

type ProfilePayload = {
  user: {
    id: string;
    niche: string | null;
    tone: string | null;
    timezone: string;
  };
  sources: Array<{ id: string; url: string; enabled: boolean; isCurated: boolean }>;
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

type RenderJobOutput = {
  audioStatus?: "generated" | "missing";
  audioError?: string | null;
  variants?: Array<{ variantIndex: number; path: string; duration: number; hasAudio?: boolean }>;
};

const STEPS = [
  "Fetch trends",
  "Select trend",
  "Generate ideas",
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
  const [isMediaPanelOpen, setIsMediaPanelOpen] = useState(false);

  const [trends, setTrends] = useState<Trend[]>([]);
  const [selectedTrendIndex, setSelectedTrendIndex] = useState(0);
  const [trendSearchQuery, setTrendSearchQuery] = useState("");

  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [selectedIdeaIndex, setSelectedIdeaIndex] = useState(0);
  const [linkUploadedMediaToIdeas, setLinkUploadedMediaToIdeas] = useState(true);

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
  const sourcePresetMatch = profile ? findMatchingCuratedPreset(profile.sources.map((source) => source.url)) : null;
  const sourceMode = profile ? (profile.sources.every((source) => source.isCurated) || sourcePresetMatch ? "curated" : "custom") : null;
  const nicheLabel = profile?.user.niche ?? "General / Mixed";
  const latestRenderOutput =
    latestRenderJob?.outputJson && typeof latestRenderJob.outputJson === "object" ? (latestRenderJob.outputJson as RenderJobOutput) : null;

  const renderVariantOptions = useMemo(() => {
    const outputVariants = latestRenderOutput?.variants ?? [];
    return (latestRenderJob?.renders ?? []).map((render) => ({
      id: render.id,
      label: `Variant ${render.variantIndex} (${render.duration}s)`,
      path: render.path,
      previewUrl: `/api/renders/${render.id}`,
      hasAudio: outputVariants.find((variant) => variant.variantIndex === render.variantIndex)?.hasAudio,
    }));
  }, [latestRenderJob?.renders, latestRenderOutput?.variants]);

  const filteredTrendEntries = useMemo(() => {
    const query = trendSearchQuery.trim().toLowerCase();
    return trends
      .map((trend, index) => ({ trend, index }))
      .filter(({ trend }) => {
        if (!query) {
          return true;
        }

        const searchableText = [
          trend.trendTitle,
          trend.summary,
          trend.fitLabel,
          trend.fitReason,
          ...trend.links,
          ...(trend.sourceLinks ?? []).flatMap((link) => [link.title, link.url, link.sourceUrl]),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return searchableText.includes(query);
      });
  }, [trendSearchQuery, trends]);

  const filteredSelectedTrendIndex = filteredTrendEntries.findIndex((entry) => entry.index === selectedTrendIndex);
  const canContinueToIdeas = Boolean(selectedTrend) && (trendSearchQuery.trim().length === 0 || filteredSelectedTrendIndex >= 0);

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
        const outputError =
          job.outputJson && typeof job.outputJson === "object" && "error" in job.outputJson ? job.outputJson.error : null;
        const logs = Array.isArray(job.logs) ? job.logs : [];
        const latestLog = logs.at(-1)?.replace(/^\d{4}-\d{2}-\d{2}T[^ ]+\s+ERROR:\s*/, "");
        throw new Error(typeof outputError === "string" ? outputError : latestLog ?? "Job failed");
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
      const output = completed.outputJson as { trends?: Trend[]; sourceCount?: number; sourceSyncNote?: string | null };
      const fetchedTrends = output?.trends ?? [];

      setTrends(fetchedTrends);
      setSelectedTrendIndex(0);
      setSelectedIdeaIndex(0);
      setTrendSearchQuery("");
      setIdeas([]);
      setMetadata(null);
      setSchedule(null);
      void loadProfile();
      setMessage(
        `Fetched ${fetchedTrends.length} ranked trends from ${output?.sourceCount ?? profile?.sources.length ?? 0} sources.${
          output?.sourceSyncNote ? ` ${output.sourceSyncNote}` : ""
        }`,
      );
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
        body: JSON.stringify({
          trend: trendForIdeas,
          mediaAssetIds: linkUploadedMediaToIdeas ? assets.map((asset) => asset.id) : [],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to start ideas job");
      }

      const completed = await waitForJob(data.jobId, "ideas");
      const output = completed.outputJson as { ideas?: Idea[]; linkedMediaCount?: number };
      const generatedIdeas = output.ideas ?? [];
      const linkedMediaCount = output.linkedMediaCount ?? 0;

      setIdeas(generatedIdeas);
      setSelectedIdeaIndex(0);
      setMetadata(null);
      setSchedule(null);
      setMessage(
        linkedMediaCount > 0
          ? `Generated ${generatedIdeas.length} idea candidates using ${linkedMediaCount} uploaded media asset${linkedMediaCount === 1 ? "" : "s"}.`
          : `Generated ${generatedIdeas.length} idea candidates.`,
      );
      setActiveStep(2);
      return generatedIdeas;
    } catch (jobError) {
      setError(jobError instanceof Error ? jobError.message : "Idea generation failed");
      return null;
    }
  };

  const startRenderJobWithOptions = async (payload: {
    trend: Trend;
    idea: Idea;
    mediaAssetIds: string[];
    preference: "auto" | "shorts" | "landscape";
    allowIrrelevantMedia: boolean;
    storyboard?: StoryboardPlan;
  }) => {
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

  const analyzeStoryboardForIdea = async (payload: {
    trend: Trend;
    idea: Idea;
    mediaAssetIds: string[];
    preference: "auto" | "shorts" | "landscape";
  }) => {
    const response = await fetch("/api/storyboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? "Failed to analyze storyboard coverage");
    }

    return data as { storyboard: StoryboardPlan; assessment: { shouldBlock: boolean; summary: string } };
  };

  const handleRenderJobCreated = async (jobId: string) => {
    setError(null);
    setMessage("Render job started.");

    try {
      const completed = await waitForJob(jobId, "render");
      setLatestRenderJob(completed);
      setMessage("Rendering complete. Generating metadata and schedule...");
      setActiveStep(4);
      const metadataResult = await generateMetadataAndSchedule({ advanceStep: true });
      if (!metadataResult) {
        setMessage("Rendering complete. Metadata generation needs attention.");
        return;
      }

      setMessage("Rendering, metadata, and schedule generation complete.");
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
        setActiveStep(5);
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
        setMessage("Autopilot paused before render. Upload media from the top-right button, then continue to render.");
        return;
      }

      const storyboardResult = await analyzeStoryboardForIdea({
        trend: trendForPipeline,
        idea: ideaForPipeline,
        mediaAssetIds: assets.map((asset) => asset.id),
        preference: "auto",
      });

      if (storyboardResult.storyboard.shouldBlock) {
        setActiveStep(3);
        setMessage(`Autopilot paused before render. ${storyboardResult.storyboard.coverageSummary}`);
        return;
      }

      setActiveStep(3);
      setMessage(
        `Autopilot using ${assets.length} existing media asset${assets.length === 1 ? "" : "s"}${
          storyboardResult.storyboard.generatedSupportUsed ? " plus generated support for uncovered beats" : ""
        } and starting render...`,
      );
      const renderJobId = await startRenderJobWithOptions({
        trend: trendForPipeline,
        idea: ideaForPipeline,
        mediaAssetIds: assets.map((asset) => asset.id),
        preference: "auto",
        allowIrrelevantMedia: false,
        storyboard: storyboardResult.storyboard,
      });

      const completedRender = await waitForJob(renderJobId, "render");
      setLatestRenderJob(completedRender);

      setActiveStep(4);
      const metadataResult = await generateMetadataAndSchedule({
        trend: trendForPipeline,
        idea: ideaForPipeline,
        advanceStep: false,
      });

      if (!metadataResult) {
        setActiveStep(4);
        return;
      }

      const defaultVariantId = completedRender.renders?.[0]?.id;
      if (!defaultVariantId) {
        setActiveStep(5);
        setMessage("Autopilot completed through metadata. No render variant available to upload.");
        return;
      }

      const completedRenderOutput =
        completedRender.outputJson && typeof completedRender.outputJson === "object" ? (completedRender.outputJson as RenderJobOutput) : null;
      const firstVariantHasAudio = completedRenderOutput?.variants?.find((variant) => variant.variantIndex === 1)?.hasAudio;
      if (completedRenderOutput?.audioStatus === "missing" || firstVariantHasAudio === false) {
        setActiveStep(5);
        setMessage("Autopilot paused before YouTube. The selected render does not contain generated narration/audio yet.");
        return;
      }

      setActiveStep(5);
      const youtubeJob = await startYoutubeUpload({
        renderId: defaultVariantId,
        publishAt: metadataResult.schedule.publishAt,
        metadataOverride: metadataResult.metadata,
      });

      if (!youtubeJob) {
        setActiveStep(5);
        return;
      }

      setActiveStep(5);
      setMessage("Autopilot completed all available steps.");
    } catch (autopilotError) {
      setError(autopilotError instanceof Error ? autopilotError.message : "Autopilot failed");
    } finally {
      setIsAutopilotRunning(false);
    }
  };

  const handleTrendSelect = (index: number) => {
    setSelectedTrendIndex(index);
    setIdeas([]);
    setSelectedIdeaIndex(0);
    setMetadata(null);
    setSchedule(null);
    setError(null);
    setMessage("Trend selected. Generate ideas when ready.");
  };

  const buildCustomTrend = (query: string): Trend => ({
    trendTitle: query.trim(),
    summary: `Custom topic search for ${query.trim()}. Turn it into a creator-ready angle${linkUploadedMediaToIdeas && assets.length > 0 ? " that can be supported by the uploaded media." : " that fits the creator's niche."}`,
    links: [],
    fitLabel: "Open feed",
    fitReason: "Added from manual trend search.",
  });

  const applyTypedTrend = async (options?: { generateIdeasNow?: boolean }) => {
    const query = trendSearchQuery.trim();

    if (!query) {
      setError("Enter a trend to search or use as a custom topic.");
      return;
    }

    const customTrend = buildCustomTrend(query);
    const remainingTrends = trends.filter((trend) => trend.trendTitle.trim().toLowerCase() !== query.toLowerCase());

    setTrends([customTrend, ...remainingTrends]);
    setSelectedTrendIndex(0);
    setIdeas([]);
    setSelectedIdeaIndex(0);
    setMetadata(null);
    setSchedule(null);
    setError(null);

    if (options?.generateIdeasNow) {
      await runIdeas(customTrend);
      return;
    }

    setMessage(`Added "${customTrend.trendTitle}" as a custom trend.`);
    setActiveStep(1);
  };

  const renderStepContent = () => {
    switch (activeStep) {
      case 0:
        return (
          <section className="space-y-3">
            <p className="text-sm text-[var(--cp-muted)]">
              Fetch RSS feeds, rank up to 5 trend groups for your niche, then turn the selected trend into creator-ready ideas.
            </p>
            <Card size="sm" className="border-[var(--cp-border)] bg-[var(--cp-surface-soft)] py-0 ring-0">
              <CardContent className="space-y-1 p-3 text-xs text-[var(--cp-muted)]">
                <p>
                  Niche: <span className="font-medium text-[var(--cp-ink)]">{nicheLabel}</span>
                </p>
                <p>
                  Feed mode:{" "}
                  <span className="font-medium text-[var(--cp-ink)]">
                    {profile ? `${sourceMode === "curated" ? "Curated" : "Custom"} (${profile.sources.length} sources)` : "Loading..."}
                  </span>
                </p>
                <p>Uploaded media can be linked into idea generation and stays available for render coverage at any point.</p>
                <p>
                  {sourceMode === "curated"
                    ? "Curated feeds stay aligned to your selected niche."
                    : sourceMode === "custom"
                      ? "Custom feeds can surface broader stories; trend cards label how closely each story fits your niche."
                      : "Loading feed settings..."}
                </p>
              </CardContent>
            </Card>
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
              Autopilot uses the top-ranked trend and first idea by default, then pauses if media is missing.
            </p>
            <p className="text-xs text-[var(--cp-muted-dim)]">Sources configured: {profile?.sources.length ?? 0}</p>
          </section>
        );
      case 1:
        return (
          <section className="space-y-3">
            <Card size="sm" className="border-[var(--cp-border)] bg-[var(--cp-surface-soft)] py-0 ring-0">
              <CardContent className="space-y-3 p-3">
                <div className="space-y-1">
                  <Label htmlFor="trend-search" className="text-[var(--cp-ink)]">
                    Search fetched trends or type a custom topic
                  </Label>
                  <p className="text-xs text-[var(--cp-muted)]">
                    Use the search box to filter fetched trends below, or turn the typed topic into a custom trend and generate ideas immediately.
                  </p>
                </div>
                <div className="flex flex-col gap-2 md:flex-row">
                  <Input
                    id="trend-search"
                    value={trendSearchQuery}
                    onChange={(event) => setTrendSearchQuery(event.target.value)}
                    placeholder="Example: Instagram SEO update"
                    className="border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-[var(--cp-ink)]"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        void applyTypedTrend();
                      }}
                      disabled={trendSearchQuery.trim().length === 0}
                      className="border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-[var(--cp-ink-soft)] hover:bg-[var(--cp-surface-muted)]"
                    >
                      <SearchIcon className="mr-1 size-4" />
                      Use typed trend
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        void applyTypedTrend({ generateIdeasNow: true });
                      }}
                      disabled={trendSearchQuery.trim().length === 0}
                      className="text-white"
                    >
                      Generate ideas from typed trend
                    </Button>
                  </div>
                </div>
                {trendSearchQuery.trim().length > 0 && filteredTrendEntries.length === 0 ? (
                  <p className="text-xs text-[var(--cp-muted-soft)]">
                    No fetched trends match this search yet. You can still use the typed topic as a custom trend.
                  </p>
                ) : null}
              </CardContent>
            </Card>
            <TrendPicker
              trends={filteredTrendEntries.map((entry) => entry.trend)}
              selectedIndex={filteredSelectedTrendIndex}
              onSelect={(visibleIndex) => {
                const next = filteredTrendEntries[visibleIndex];
                if (next) {
                  handleTrendSelect(next.index);
                }
              }}
            />
            <Button
              type="button"
              onClick={() => setActiveStep(2)}
              disabled={!canContinueToIdeas}
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
            {selectedTrend?.fitReason ? (
              <Card size="sm" className="border-[var(--cp-border)] bg-[var(--cp-surface-soft)] py-0 ring-0">
                <CardContent className="p-3 text-xs text-[var(--cp-muted)]">
                  <span className="font-medium text-[var(--cp-ink)]">{selectedTrend.fitLabel}:</span> {selectedTrend.fitReason}
                </CardContent>
              </Card>
            ) : null}
            <Card size="sm" className="border-[var(--cp-border)] bg-[var(--cp-surface-soft)] py-0 ring-0">
              <CardContent className="flex items-start gap-3 p-3">
                <Checkbox
                  id="link-media-to-ideas"
                  checked={linkUploadedMediaToIdeas}
                  disabled={assets.length === 0}
                  onCheckedChange={(checked) => setLinkUploadedMediaToIdeas(checked === true)}
                  className="mt-0.5"
                />
                <div className="space-y-1">
                  <Label htmlFor="link-media-to-ideas" className="text-[var(--cp-ink)]">
                    Link uploaded media to ideas
                  </Label>
                  <p className="text-xs text-[var(--cp-muted)]">
                    {assets.length > 0
                      ? `Use ${assets.length} uploaded media asset${assets.length === 1 ? "" : "s"} as context so ideas stay grounded in visuals you already have.`
                      : "Upload media from the top-right button to let idea generation use your existing screenshots and clips."}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Button
              type="button"
              onClick={() => {
                void runIdeas();
              }}
              disabled={!selectedTrend}
              className="text-white"
            >
              {linkUploadedMediaToIdeas && assets.length > 0 ? "Generate ideas with media context" : "Generate ideas"}
            </Button>
            <IdeaCards ideas={ideas} selectedIndex={selectedIdeaIndex} onSelect={setSelectedIdeaIndex} />
            <Button
              type="button"
              onClick={() => setActiveStep(3)}
              disabled={!selectedIdea || ideas.length === 0}
              variant="outline"
              className="border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-[var(--cp-ink-soft)] hover:bg-[var(--cp-surface-muted)]"
            >
              Continue to render
            </Button>
          </section>
        );
      case 3:
        return (
          <section className="space-y-3">
            {assets.length === 0 ? (
              <Card size="sm" className="border-[var(--cp-border)] bg-[var(--cp-surface-soft)] py-0 ring-0">
                <CardContent className="p-3 text-sm text-[var(--cp-muted)]">
                  Upload media from the top-right button before rendering. Render analysis uses your current asset library and any generated support if coverage is weak.
                </CardContent>
              </Card>
            ) : null}
            <RenderPanel trend={selectedTrend} idea={selectedIdea} assets={assets} onJobCreated={handleRenderJobCreated} />
            {latestRenderJob?.status === "complete" ? (
              <p className="text-sm text-[var(--cp-success)]">Last render complete. You can proceed to metadata.</p>
            ) : null}
          </section>
        );
      case 4:
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
      case 5:
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
            audioStatus={latestRenderOutput?.audioStatus ?? null}
            audioError={latestRenderOutput?.audioError ?? null}
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
              End-to-end pipeline: trends → ideas → render → metadata → schedule → YouTube upload. Media upload stays available from the top right.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant={isMediaPanelOpen ? "secondary" : "outline"}
            onClick={() => setIsMediaPanelOpen((current) => !current)}
            className={
              isMediaPanelOpen
                ? "bg-[var(--cp-highlight)] text-[var(--cp-deep)] hover:bg-[var(--cp-highlight)]/90"
                : "border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-[var(--cp-ink-soft)] hover:bg-[var(--cp-surface-muted)]"
            }
          >
            {isMediaPanelOpen ? <XIcon className="mr-1 size-4" /> : <UploadIcon className="mr-1 size-4" />}
            {isMediaPanelOpen ? "Hide media" : `Upload media${assets.length > 0 ? ` (${assets.length})` : ""}`}
          </Button>
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

      {isMediaPanelOpen ? (
        <Card className="mb-4 border-[var(--cp-border)] bg-[var(--cp-surface)] py-0 shadow-sm ring-0">
          <CardContent className="p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--cp-muted-dim)]">Media Library</h2>
                <p className="mt-1 text-sm text-[var(--cp-muted)]">
                  Upload media whenever you want. These assets can guide idea generation and will be available during render analysis.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsMediaPanelOpen(false)}
                className="text-[var(--cp-muted)] hover:bg-[var(--cp-surface-soft)]"
              >
                Close
              </Button>
            </div>
            <UploadPanel
              assets={assets}
              onUploaded={(uploadedAssets) => {
                setAssets((current) => [...uploadedAssets, ...current]);
                setMessage(
                  `Uploaded ${uploadedAssets.length} media asset${uploadedAssets.length === 1 ? "" : "s"}. They are now available for idea generation and render.`,
                );
              }}
              onDeleted={(deletedAsset) => {
                const assetName = deletedAsset.path.split(/[/\\]/).at(-1) ?? deletedAsset.path;
                setAssets((current) => current.filter((asset) => asset.id !== deletedAsset.id));
                setMessage(`Deleted ${assetName} from the media library.`);
              }}
            />
          </CardContent>
        </Card>
      ) : null}

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
