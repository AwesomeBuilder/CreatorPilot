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
import { Textarea } from "@/components/ui/textarea";
import { findMatchingCuratedPreset } from "@/lib/default-sources";
import type {
  Idea,
  IdeaContextAssessment,
  IdeaGenerationMode,
  MetadataResult,
  RenderAudioComposition,
  ScheduleRecommendation,
  StoryboardPlan,
  Trend,
  WorkflowMode,
} from "@/lib/types";

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
  audioComposition?: RenderAudioComposition;
  variants?: Array<{ variantIndex: number; path: string; duration: number; hasAudio?: boolean }>;
};

type IdeasJobOutput = {
  ideas?: Idea[];
  linkedMediaCount?: number;
  generationMode?: IdeaGenerationMode;
  contextAssessment?: IdeaContextAssessment;
  derivedContextTrend?: Trend;
  workflow?: WorkflowMode;
};

const TREND_STEPS = [
  "Fetch trends",
  "Select trend",
  "Generate ideas",
  "Render video",
  "Generate metadata",
  "Upload to YouTube",
];

const MEDIA_LED_STEPS = ["Select media", "Add optional brief", "Generate angle(s)", "Render/arrangement", "Metadata/upload"];

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function DashboardPage() {
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("trend");
  const [activeStep, setActiveStep] = useState(0);
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [isMediaPanelOpen, setIsMediaPanelOpen] = useState(false);

  const [trends, setTrends] = useState<Trend[]>([]);
  const [selectedTrendIndex, setSelectedTrendIndex] = useState(-1);
  const [trendSearchQuery, setTrendSearchQuery] = useState("");

  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [selectedIdeaIndex, setSelectedIdeaIndex] = useState(-1);
  const [linkUploadedMediaToIdeas, setLinkUploadedMediaToIdeas] = useState(true);
  const [mediaLedSelectedAssetIds, setMediaLedSelectedAssetIds] = useState<string[]>([]);
  const [mediaLedBrief, setMediaLedBrief] = useState("");
  const [mediaLedDerivedTrend, setMediaLedDerivedTrend] = useState<Trend | null>(null);
  const [ideaGenerationMode, setIdeaGenerationMode] = useState<IdeaGenerationMode | null>(null);
  const [ideaContextAssessment, setIdeaContextAssessment] = useState<IdeaContextAssessment | null>(null);

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
  const effectiveTrend = workflowMode === "trend" ? selectedTrend : mediaLedDerivedTrend;
  const selectedMediaLedAssets = useMemo(
    () => assets.filter((asset) => mediaLedSelectedAssetIds.includes(asset.id)),
    [assets, mediaLedSelectedAssetIds],
  );
  const steps = workflowMode === "trend" ? TREND_STEPS : MEDIA_LED_STEPS;
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

  useEffect(() => {
    setMediaLedSelectedAssetIds((current) => current.filter((assetId) => assets.some((asset) => asset.id === assetId)));
  }, [assets]);

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

  const clearPipelineOutputs = () => {
    setIdeas([]);
    setSelectedIdeaIndex(-1);
    setIdeaGenerationMode(null);
    setIdeaContextAssessment(null);
    setMediaLedDerivedTrend(null);
    setMetadata(null);
    setSchedule(null);
    setLatestRenderJob(null);
    setLatestYoutubeJob(null);
  };

  const resetGeneratedState = () => {
    clearPipelineOutputs();
    setActiveJob(null);
  };

  const handleWorkflowModeChange = (nextMode: WorkflowMode) => {
    if (nextMode === workflowMode) {
      return;
    }

    setWorkflowMode(nextMode);
    setActiveStep(0);
    setSelectedTrendIndex(-1);
    setTrendSearchQuery("");
    setMediaLedSelectedAssetIds([]);
    setMediaLedBrief("");
    resetGeneratedState();
    setIsAutopilotRunning(false);
    setMessage(nextMode === "trend" ? "Switched to trend-led workflow." : "Switched to media-led explainer workflow.");
    setError(null);
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
      setSelectedIdeaIndex(-1);
      setTrendSearchQuery("");
      resetGeneratedState();
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
    setError(null);
    setMessage(null);

    try {
      if (workflowMode === "media-led") {
        if (mediaLedSelectedAssetIds.length === 0) {
          setError("Select at least one uploaded asset first.");
          setActiveStep(0);
          return null;
        }

        const response = await fetch("/api/ideas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflow: "media-led",
            mediaAssetIds: mediaLedSelectedAssetIds,
            brief: mediaLedBrief.trim() || undefined,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "Failed to start media-led idea generation");
        }

        const completed = await waitForJob(data.jobId, "ideas");
        const output = (completed.outputJson as IdeasJobOutput | null) ?? {};
        const generatedIdeas = output.ideas ?? [];
        const generationMode = output.generationMode ?? (generatedIdeas.length <= 1 ? "single-plan" : "multi-idea");
        const linkedMediaCount = output.linkedMediaCount ?? mediaLedSelectedAssetIds.length;

        setIdeas(generatedIdeas);
        setSelectedIdeaIndex(generatedIdeas.length > 0 ? 0 : -1);
        setIdeaGenerationMode(generationMode);
        setIdeaContextAssessment(output.contextAssessment ?? null);
        setMediaLedDerivedTrend(output.derivedContextTrend ?? null);
        setMetadata(null);
        setSchedule(null);
        setLatestRenderJob(null);
        setLatestYoutubeJob(null);

        if (generationMode === "needs-brief") {
          setActiveStep(1);
          setMessage("More written context is needed before a confident story angle can be generated.");
          return output;
        }

        setActiveStep(2);
        if (generationMode === "single-plan") {
          setMessage(`Generated one render-ready story angle from ${linkedMediaCount} selected asset${linkedMediaCount === 1 ? "" : "s"}.`);
        } else {
          setMessage(
            `Generated ${generatedIdeas.length} story angle${generatedIdeas.length === 1 ? "" : "s"} using ${linkedMediaCount} selected asset${
              linkedMediaCount === 1 ? "" : "s"
            }.`,
          );
        }

        return output;
      }

      const trendForIdeas = trendOverride ?? selectedTrend;

      if (!trendForIdeas) {
        setError("Select a trend first.");
        return null;
      }

      const response = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow: "trend",
          trend: trendForIdeas,
          mediaAssetIds: linkUploadedMediaToIdeas ? assets.map((asset) => asset.id) : [],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to start ideas job");
      }

      const completed = await waitForJob(data.jobId, "ideas");
      const output = (completed.outputJson as IdeasJobOutput | null) ?? {};
      const generatedIdeas = output.ideas ?? [];
      const linkedMediaCount = output.linkedMediaCount ?? 0;

      setIdeas(generatedIdeas);
      setSelectedIdeaIndex(generatedIdeas.length > 0 ? 0 : -1);
      setIdeaGenerationMode(output.generationMode ?? "multi-idea");
      setIdeaContextAssessment(output.contextAssessment ?? null);
      setMediaLedDerivedTrend(null);
      setMetadata(null);
      setSchedule(null);
      setLatestRenderJob(null);
      setLatestYoutubeJob(null);
      setMessage(
        linkedMediaCount > 0
          ? `Generated ${generatedIdeas.length} idea candidates using ${linkedMediaCount} uploaded media asset${linkedMediaCount === 1 ? "" : "s"}.`
          : `Generated ${generatedIdeas.length} idea candidates.`,
      );
      setActiveStep(2);
      return output;
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
      setActiveStep(workflowMode === "trend" ? 4 : 4);
      const metadataResult = await generateMetadataAndSchedule({ advanceStep: workflowMode === "trend" });
      if (!metadataResult) {
        setMessage("Rendering complete. Metadata generation needs attention.");
        return;
      }

      setMessage(
        workflowMode === "trend"
          ? "Rendering, metadata, and schedule generation complete."
          : "Rendering, metadata, and scheduling are ready. Review the upload options below.",
      );
    } catch (jobError) {
      setError(jobError instanceof Error ? jobError.message : "Render job failed");
    }
  };

  const generateMetadataAndSchedule = async (params?: { trend?: Trend; idea?: Idea; advanceStep?: boolean }) => {
    const trendForMetadata = params?.trend ?? effectiveTrend;
    const ideaForMetadata = params?.idea ?? selectedIdea;
    const shouldAdvance = params?.advanceStep ?? (workflowMode === "trend");

    if (!trendForMetadata || !ideaForMetadata) {
      setError(workflowMode === "trend" ? "Select trend and idea first." : "Generate a story angle first.");
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
        setActiveStep(workflowMode === "trend" ? 5 : 4);
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
      if (workflowMode === "media-led") {
        if (mediaLedSelectedAssetIds.length === 0) {
          setActiveStep(0);
          setMessage("Autopilot paused: select at least one uploaded asset for the media-led workflow.");
          return;
        }

        const generatedOutput = await runIdeas();
        const mediaLedOutput = (generatedOutput as IdeasJobOutput | null) ?? null;
        const ideaForPipeline = mediaLedOutput?.ideas?.[0] ?? null;
        const derivedTrend = mediaLedOutput?.derivedContextTrend ?? mediaLedDerivedTrend;

        if (mediaLedOutput?.generationMode === "needs-brief") {
          setActiveStep(1);
          setMessage("Autopilot paused: add a short brief so the media-led workflow has enough context.");
          return;
        }

        if (mediaLedOutput?.generationMode === "multi-idea") {
          setActiveStep(2);
          setMessage("Autopilot paused at angle selection. Choose the story angle you want to render.");
          return;
        }

        if (!ideaForPipeline || !derivedTrend) {
          setActiveStep(2);
          setMessage("Autopilot stopped: no render-ready media-led angle was generated.");
          return;
        }

        const storyboardResult = await analyzeStoryboardForIdea({
          trend: derivedTrend,
          idea: ideaForPipeline,
          mediaAssetIds: mediaLedSelectedAssetIds,
          preference: "auto",
        });

        if (storyboardResult.storyboard.shouldBlock) {
          setActiveStep(3);
          setMessage(`Autopilot paused before render. ${storyboardResult.storyboard.coverageSummary}`);
          return;
        }

        setActiveStep(3);
        setMessage(
          `Autopilot using ${mediaLedSelectedAssetIds.length} selected asset${mediaLedSelectedAssetIds.length === 1 ? "" : "s"}${
            storyboardResult.storyboard.generatedSupportUsed ? " plus generated support for uncovered beats" : ""
          } and starting render...`,
        );
        const renderJobId = await startRenderJobWithOptions({
          trend: derivedTrend,
          idea: ideaForPipeline,
          mediaAssetIds: mediaLedSelectedAssetIds,
          preference: "auto",
          allowIrrelevantMedia: false,
          storyboard: storyboardResult.storyboard,
        });

        const completedRender = await waitForJob(renderJobId, "render");
        setLatestRenderJob(completedRender);

        setActiveStep(4);
        const metadataResult = await generateMetadataAndSchedule({
          trend: derivedTrend,
          idea: ideaForPipeline,
          advanceStep: false,
        });

        if (!metadataResult) {
          setActiveStep(4);
          return;
        }

        const defaultVariantId = completedRender.renders?.[0]?.id;
        if (!defaultVariantId) {
          setActiveStep(4);
          setMessage("Autopilot completed through metadata. No render variant is available to upload.");
          return;
        }

        const completedRenderOutput =
          completedRender.outputJson && typeof completedRender.outputJson === "object" ? (completedRender.outputJson as RenderJobOutput) : null;
        const firstVariantHasAudio = completedRenderOutput?.variants?.find((variant) => variant.variantIndex === 1)?.hasAudio;
        if (completedRenderOutput?.audioStatus === "missing" || firstVariantHasAudio === false) {
          setActiveStep(4);
          setMessage("Autopilot paused before upload. The selected render does not contain generated narration/audio yet.");
          return;
        }

        const youtubeJob = await startYoutubeUpload({
          renderId: defaultVariantId,
          publishAt: metadataResult.schedule.publishAt,
          metadataOverride: metadataResult.metadata,
        });

        if (!youtubeJob) {
          setActiveStep(4);
          return;
        }

        setActiveStep(4);
        setMessage("Autopilot completed all available media-led steps.");
        return;
      }

      const fetchedTrends = await runTrends();
      const trendForPipeline = fetchedTrends?.[0] ?? null;

      if (!trendForPipeline) {
        setActiveStep(1);
        setMessage("Autopilot stopped: no trends were found.");
        return;
      }

      const ideasOutput = await runIdeas(trendForPipeline);
      const ideaForPipeline = ideasOutput?.ideas?.[0] ?? null;

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
    setSelectedIdeaIndex(-1);
    setIdeaGenerationMode(null);
    setIdeaContextAssessment(null);
    setMetadata(null);
    setSchedule(null);
    setLatestRenderJob(null);
    setLatestYoutubeJob(null);
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
    resetGeneratedState();
    setError(null);

    if (options?.generateIdeasNow) {
      await runIdeas(customTrend);
      return;
    }

    setMessage(`Added "${customTrend.trendTitle}" as a custom trend.`);
    setActiveStep(1);
  };

  const renderStepContent = () => {
    if (workflowMode === "media-led") {
      switch (activeStep) {
        case 0:
          return (
            <section className="space-y-3">
              <p className="text-sm text-[var(--cp-muted)]">
                Choose the uploaded screenshots or clips that should define this explainer. The media library stays global, but this run only uses the assets
                you select here.
              </p>
              {assets.length === 0 ? (
                <Card size="sm" className="border-[var(--cp-border)] bg-[var(--cp-surface-soft)] py-0 ring-0">
                  <CardContent className="p-3 text-sm text-[var(--cp-muted)]">
                    Upload screenshots or video clips from the top-right media library first. This workflow starts from your own media, then builds the story
                    around it.
                  </CardContent>
                </Card>
              ) : (
                <Card size="sm" className="border-[var(--cp-border)] bg-[var(--cp-surface-soft)] py-0 ring-0">
                  <CardContent className="space-y-3 p-3">
                    <p className="text-xs text-[var(--cp-muted)]">
                      Selected assets:{" "}
                      <span className="font-medium text-[var(--cp-ink)]">
                        {mediaLedSelectedAssetIds.length} of {assets.length}
                      </span>
                    </p>
                    <div className="grid gap-2">
                      {assets.map((asset) => {
                        const checked = mediaLedSelectedAssetIds.includes(asset.id);
                        const inputId = `media-led-asset-${asset.id}`;
                        return (
                          <div key={asset.id} className="rounded border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-2">
                            <div className="flex items-start gap-2">
                              <Checkbox
                                id={inputId}
                                checked={checked}
                                onCheckedChange={() => {
                                  clearPipelineOutputs();
                                  setMediaLedSelectedAssetIds((current) =>
                                    current.includes(asset.id) ? current.filter((assetId) => assetId !== asset.id) : [...current, asset.id],
                                  );
                                }}
                                className="mt-0.5 border-[var(--cp-border-strong)]"
                              />
                              <div className="min-w-0 flex-1">
                                <Label htmlFor={inputId} className="block truncate text-xs font-medium text-[var(--cp-ink)]">
                                  {asset.path}
                                </Label>
                                <p className="mt-1 text-[11px] uppercase tracking-wide text-[var(--cp-muted)]">{asset.type}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => setActiveStep(1)}
                  disabled={mediaLedSelectedAssetIds.length === 0}
                  className="text-white"
                >
                  Continue to brief
                </Button>
                {assets.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      clearPipelineOutputs();
                      setMediaLedSelectedAssetIds(assets.map((asset) => asset.id));
                    }}
                    className="border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-[var(--cp-ink-soft)] hover:bg-[var(--cp-surface-muted)]"
                  >
                    Select all uploads
                  </Button>
                ) : null}
              </div>
            </section>
          );
        case 1:
          return (
            <section className="space-y-3">
              <p className="text-sm text-[var(--cp-muted)]">
                Add optional context about what the audience should understand. Leave this blank if the uploaded media already tells a clear story.
              </p>
              <Card size="sm" className="border-[var(--cp-border)] bg-[var(--cp-surface-soft)] py-0 ring-0">
                <CardContent className="space-y-3 p-3">
                  <div className="space-y-1">
                    <Label htmlFor="media-led-brief" className="text-[var(--cp-ink)]">
                      Optional brief
                    </Label>
                    <p className="text-xs text-[var(--cp-muted)]">
                      Example: what this is, how it works, why it matters, what the audience should take away, or what future direction to emphasize.
                    </p>
                  </div>
                  <Textarea
                    id="media-led-brief"
                    value={mediaLedBrief}
                    onChange={(event) => {
                      clearPipelineOutputs();
                      setMediaLedBrief(event.target.value);
                    }}
                    placeholder="Example: This is a new creator analytics workflow. Show the before/after, how the dashboard works, and close on what it unlocks next."
                    className="min-h-32 border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-[var(--cp-ink-soft)]"
                  />
                  <p className="text-xs text-[var(--cp-muted-dim)]">
                    {selectedMediaLedAssets.length} selected asset{selectedMediaLedAssets.length === 1 ? "" : "s"} will be analyzed with this context.
                  </p>
                </CardContent>
              </Card>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => setActiveStep(2)} disabled={mediaLedSelectedAssetIds.length === 0} className="text-white">
                  Continue to angles
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void runIdeas();
                  }}
                  disabled={mediaLedSelectedAssetIds.length === 0}
                  className="border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-[var(--cp-ink-soft)] hover:bg-[var(--cp-surface-muted)]"
                >
                  Generate angle(s) now
                </Button>
              </div>
            </section>
          );
        case 2:
          return (
            <section className="space-y-3">
              <p className="text-sm text-[var(--cp-muted)]">Generate an explainer angle from the selected media and optional brief.</p>
              {ideaContextAssessment ? (
                <Card size="sm" className="border-[var(--cp-border)] bg-[var(--cp-surface-soft)] py-0 ring-0">
                  <CardContent className="space-y-2 p-3 text-xs text-[var(--cp-muted)]">
                    <p>
                      <span className="font-medium text-[var(--cp-ink)]">Context summary:</span> {ideaContextAssessment.summary}
                    </p>
                    <p>
                      <span className="font-medium text-[var(--cp-ink)]">Confidence:</span> {ideaContextAssessment.confidence}/100
                    </p>
                    {ideaContextAssessment.requiresBrief ? (
                      <div>
                        <p className="font-medium text-[var(--cp-ink)]">What to add:</p>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          {ideaContextAssessment.missingContextPrompts.map((prompt) => (
                            <li key={prompt}>{prompt}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}
              {mediaLedDerivedTrend ? (
                <Card size="sm" className="border-[var(--cp-border)] bg-[var(--cp-surface-soft)] py-0 ring-0">
                  <CardContent className="space-y-1 p-3 text-xs text-[var(--cp-muted)]">
                    <p>
                      <span className="font-medium text-[var(--cp-ink)]">Derived context:</span> {mediaLedDerivedTrend.trendTitle}
                    </p>
                    <p>{mediaLedDerivedTrend.summary}</p>
                  </CardContent>
                </Card>
              ) : null}
              <Button
                type="button"
                onClick={() => {
                  void runIdeas();
                }}
                disabled={mediaLedSelectedAssetIds.length === 0}
                className="text-white"
              >
                {ideaGenerationMode === "single-plan" ? "Regenerate angle" : "Generate angle(s)"}
              </Button>
              <IdeaCards
                ideas={ideas}
                selectedIndex={selectedIdeaIndex}
                onSelect={setSelectedIdeaIndex}
                emptyText="No angles yet. Select media, add optional context, and generate the story angles."
              />
              <Button
                type="button"
                onClick={() => setActiveStep(3)}
                disabled={!selectedIdea || !mediaLedDerivedTrend || ideaGenerationMode === "needs-brief"}
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
              {mediaLedSelectedAssetIds.length === 0 ? (
                <Card size="sm" className="border-[var(--cp-border)] bg-[var(--cp-surface-soft)] py-0 ring-0">
                  <CardContent className="p-3 text-sm text-[var(--cp-muted)]">
                    Select the media assets for this explainer before rendering. Coverage analysis will stay scoped to those chosen uploads.
                  </CardContent>
                </Card>
              ) : null}
              <RenderPanel
                trend={effectiveTrend}
                idea={selectedIdea}
                assets={assets}
                onJobCreated={handleRenderJobCreated}
                mode="media-led"
                defaultSelectedAssetIds={mediaLedSelectedAssetIds}
                selectionKey={`media-led:${effectiveTrend?.trendTitle ?? "none"}:${selectedIdea?.videoTitle ?? "none"}:${mediaLedSelectedAssetIds.join(",")}`}
                emptySelectionUsesAllAssets={false}
                selectionDescription="The selected media-led assets are prefilled. Add or remove uploads here if you want the render analysis to use a different mix."
              />
              {latestRenderJob?.status === "complete" ? (
                <p className="text-sm text-[var(--cp-success)]">Last render complete. Review metadata and upload options below.</p>
              ) : null}
            </section>
          );
        case 4:
          return (
            <section className="space-y-4">
              <MetadataPanel
                trend={effectiveTrend}
                idea={selectedIdea}
                metadata={metadata}
                schedule={schedule}
                loading={isMetadataLoading}
                onGenerate={generateMetadataAndSchedule}
              />
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
                audioComposition={latestRenderOutput?.audioComposition ?? null}
                onConnect={connectYouTube}
                onUpload={startYoutubeUpload}
                isUploading={isYoutubeStarting}
              />
            </section>
          );
        default:
          return null;
      }
    }

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
              <Button type="button" onClick={runTrends} className="text-white">
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
            audioComposition={latestRenderOutput?.audioComposition ?? null}
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
              {workflowMode === "trend"
                ? "Trend-led pipeline: trends → ideas → render → metadata → schedule → YouTube upload. Media upload stays available from the top right."
                : "Media-led explainer pipeline: selected media → optional brief → angle generation → render → metadata/upload. App demos are just one example."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={workflowMode === "trend" ? "secondary" : "outline"}
              onClick={() => handleWorkflowModeChange("trend")}
              className={
                workflowMode === "trend"
                  ? "bg-[var(--cp-highlight)] text-[var(--cp-deep)] hover:bg-[var(--cp-highlight)]/90"
                  : "border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-[var(--cp-ink-soft)] hover:bg-[var(--cp-surface-muted)]"
              }
            >
              Trend-led workflow
            </Button>
            <Button
              type="button"
              variant={workflowMode === "media-led" ? "secondary" : "outline"}
              onClick={() => handleWorkflowModeChange("media-led")}
              className={
                workflowMode === "media-led"
                  ? "bg-[var(--cp-highlight)] text-[var(--cp-deep)] hover:bg-[var(--cp-highlight)]/90"
                  : "border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-[var(--cp-ink-soft)] hover:bg-[var(--cp-surface-muted)]"
              }
            >
              Media-led explainer
            </Button>
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
            {isAutopilotRunning ? "Executing..." : workflowMode === "trend" ? "Execute trend pipeline" : "Execute media-led pipeline"}
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

      <div className="grid items-start gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
        <StepSidebar steps={steps} activeStep={activeStep} onSelect={setActiveStep} />

        <Card className="min-w-0 border-[var(--cp-border)] bg-[var(--cp-surface)] py-0 shadow-sm ring-0">
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
