"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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

export default function OnboardingPage() {
  const router = useRouter();
  const [niche, setNiche] = useState("");
  const [tone, setTone] = useState("");
  const [timezone, setTimezone] = useState("America/Los_Angeles");
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

        setNiche(data.user.niche ?? "");
        setTone(data.user.tone ?? "");
        setTimezone(data.user.timezone ?? "America/Los_Angeles");
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
          niche,
          tone,
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
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">InfluencePilot Onboarding</h1>
        <p className="mt-1 text-sm text-slate-600">
          Set your creator profile, RSS sources, and YouTube connection. Keep it simple for MVP.
        </p>
      </header>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block text-sm font-medium text-slate-800">
          Niche
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={niche}
            onChange={(event) => setNiche(event.target.value)}
            placeholder="AI tools for creators"
          />
        </label>

        <label className="block text-sm font-medium text-slate-800">
          Tone
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={tone}
            onChange={(event) => setTone(event.target.value)}
            placeholder="smart, concise, tactical"
          />
        </label>

        <label className="block text-sm font-medium text-slate-800">
          Timezone
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            placeholder="America/Los_Angeles"
          />
        </label>

        <label className="block text-sm font-medium text-slate-800">
          RSS sources (one per line)
          <textarea
            className="mt-1 min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={sourcesText}
            onChange={(event) => setSourcesText(event.target.value)}
            placeholder="Leave empty to use curated defaults after save"
          />
        </label>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-medium text-slate-900">YouTube</p>
          <p className="text-xs text-slate-700">
            Status: {youtube?.connected ? "Connected" : "Not connected"} ({youtube?.mode ?? "unknown"}) - {youtube?.reason}
          </p>
          <button
            type="button"
            onClick={connectYoutube}
            className="mt-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100"
          >
            Connect YouTube
          </button>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save and continue"}
          </button>

          <Link href="/dashboard" className="text-sm font-medium text-blue-700 underline">
            Skip to dashboard
          </Link>
        </div>

        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      </div>
    </main>
  );
}
