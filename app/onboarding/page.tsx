"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_TIMEZONE, NICHE_OPTIONS, NICHE_VALUES, TIMEZONE_OPTIONS, TIMEZONE_VALUES } from "@/lib/profile-options";

type ProfileResponse = {
  user: {
    niche: string | null;
    tone: string | null;
    timezone: string;
  };
  sources: Array<{ url: string }>;
  youtube: {
    connected: boolean;
    mode: "mock" | "live";
    reason: string;
  };
};

const NICHE_VALUE_SET = new Set<string>(NICHE_VALUES);
const TIMEZONE_VALUE_SET = new Set<string>(TIMEZONE_VALUES);
const NICHE_EMPTY_VALUE = "__none";

export default function OnboardingPage() {
  const router = useRouter();
  const [niche, setNiche] = useState("");
  const [tone, setTone] = useState("");
  const [timezone, setTimezone] = useState<string>(DEFAULT_TIMEZONE);
  const [sourcesText, setSourcesText] = useState("");
  const [youtube, setYoutube] = useState<ProfileResponse["youtube"] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const response = await fetch("/api/profile");
        const data = (await response.json()) as ProfileResponse;

        const loadedNiche = data.user.niche ?? "";
        const loadedTimezone = data.user.timezone ?? DEFAULT_TIMEZONE;

        setNiche(NICHE_VALUE_SET.has(loadedNiche) ? loadedNiche : "");
        setTone(data.user.tone ?? "");
        setTimezone(TIMEZONE_VALUE_SET.has(loadedTimezone) ? loadedTimezone : DEFAULT_TIMEZONE);
        setSourcesText(data.sources.map((source) => source.url).join("\n"));
        setYoutube(data.youtube);
      } catch {
        setError("Failed to load profile");
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, []);

  const connectYoutube = async () => {
    setMessage(null);
    setError(null);

    const response = await fetch("/api/youtube?action=auth-url");
    const data = await response.json();

    if (!response.ok) {
      setError("Failed to start YouTube auth");
      return;
    }

    if (data.authUrl) {
      window.location.href = data.authUrl;
      return;
    }

    setMessage(`Using mock mode: ${data.status?.reason ?? "OAuth not configured"}`);
    setYoutube(data.status);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const sources = sourcesText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      const response = await fetch("/api/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          niche: niche || null,
          tone: tone.trim() || null,
          timezone,
          sources,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ? JSON.stringify(data.error) : "Failed to save profile");
      }

      setYoutube(data.youtube);
      setMessage("Profile saved. Redirecting to dashboard...");
      setTimeout(() => router.push("/dashboard"), 500);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save profile");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <main className="mx-auto max-w-3xl p-6">Loading onboarding...</main>;
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-6">
      <header className="mb-6 space-y-3">
        <BrandLogo href="/dashboard" />
        <div>
          <h1 className="text-2xl font-bold text-[var(--cp-ink)]">Creator Pilot Onboarding</h1>
          <p className="mt-1 text-sm text-[var(--cp-muted-soft)]">
            Set your creator profile, RSS sources, and YouTube connection.
          </p>
        </div>
      </header>

      <Card className="border-[var(--cp-border)] bg-[var(--cp-surface)] py-0 shadow-sm ring-0">
        <CardContent className="space-y-4 p-5">
          <div className="space-y-1.5">
            <Label htmlFor="niche-select" className="text-[var(--cp-ink-soft)]">
              Niche
            </Label>
            <p className="mt-1 text-xs font-normal text-[var(--cp-muted-soft)]">
              Pick one focus area for the hackathon. This also selects default curated feeds.
            </p>
            <Select value={niche || NICHE_EMPTY_VALUE} onValueChange={(value) => setNiche(value === NICHE_EMPTY_VALUE ? "" : value)}>
              <SelectTrigger
                id="niche-select"
                className="w-full border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-sm text-[var(--cp-ink-soft)]"
              >
                <SelectValue placeholder="Select a niche" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NICHE_EMPTY_VALUE}>Select a niche</SelectItem>
                {NICHE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tone-input" className="text-[var(--cp-ink-soft)]">
              Tone
            </Label>
            <p className="mt-1 text-xs font-normal text-[var(--cp-muted-soft)]">
              Describe your writing style as comma-separated values, for example: smart, concise, tactical.
            </p>
            <Input
              id="tone-input"
              className="border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-sm text-[var(--cp-ink-soft)]"
              value={tone}
              onChange={(event) => setTone(event.target.value)}
              placeholder="smart, concise, tactical"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="timezone-select" className="text-[var(--cp-ink-soft)]">
              Timezone
            </Label>
            <p className="mt-1 text-xs font-normal text-[var(--cp-muted-soft)]">
              Used to recommend publish time in your local hours.
            </p>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger
                id="timezone-select"
                className="w-full border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-sm text-[var(--cp-ink-soft)]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sources-textarea" className="text-[var(--cp-ink-soft)]">
              RSS sources (one per line)
            </Label>
            <p className="mt-1 text-xs font-normal text-[var(--cp-muted-soft)]">
              Enter full RSS feed URLs, one URL per line. Leave this empty to auto-fill curated sources for your niche.
            </p>
            <Textarea
              id="sources-textarea"
              className="min-h-28 border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-sm text-[var(--cp-ink-soft)]"
              value={sourcesText}
              onChange={(event) => setSourcesText(event.target.value)}
              placeholder={"https://example.com/feed.xml\nhttps://another-site.com/rss"}
            />
          </div>

          <Card size="sm" className="border-[var(--cp-border)] bg-[var(--cp-surface-soft)] py-0 ring-0">
            <CardContent className="space-y-2 p-3">
              <p className="text-sm font-medium text-[var(--cp-ink)]">YouTube</p>
              <p className="text-xs text-[var(--cp-muted)]">
                Status: {youtube?.connected ? "Connected" : "Not connected"} ({youtube?.mode ?? "unknown"}) - {youtube?.reason}
              </p>
              <Button
                type="button"
                onClick={connectYoutube}
                variant="outline"
                className="border-[var(--cp-border-strong)] bg-[var(--cp-surface)] text-[var(--cp-ink-soft)] hover:bg-[var(--cp-surface-muted)]"
              >
                Connect YouTube
              </Button>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 text-sm font-semibold text-white"
            >
              {isSaving ? "Saving..." : "Save and continue"}
            </Button>

            <Link href="/dashboard" className="text-sm font-medium text-[var(--cp-link)] underline">
              Skip to dashboard
            </Link>
          </div>

          {message ? <p className="text-sm text-[var(--cp-success)]">{message}</p> : null}
          {error ? <p className="text-sm text-[var(--cp-error)]">{error}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
