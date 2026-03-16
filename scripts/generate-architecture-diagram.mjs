import { promises as fs } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const width = 2400;
const height = 1800;
const outDir = path.join(process.cwd(), "docs", "architecture");
const svgPath = path.join(outDir, "creator-pilot-architecture.svg");
const jpgPath = path.join(outDir, "creator-pilot-architecture.jpg");

const palette = {
  bg: "#f6f0e5",
  ink: "#102032",
  muted: "#4b647d",
  panel: "rgba(255,255,255,0.68)",
  panelStroke: "rgba(16,32,50,0.14)",
  line: "#35516e",
  experience: { fill: "#fff8ee", stroke: "#e4b97a", accent: "#c76c20" },
  api: { fill: "#f3f7ff", stroke: "#aac0f3", accent: "#2b63d9" },
  services: { fill: "#eef9f6", stroke: "#97d2c7", accent: "#0f766e" },
  infra: { fill: "#fff7ed", stroke: "#f0c38a", accent: "#b45309" },
  external: { fill: "#eef7fb", stroke: "#a8cfe0", accent: "#0f4c81" },
  workflow: [
    { fill: "#fef3c7", stroke: "#eab308", text: "#5b4300" },
    { fill: "#dbeafe", stroke: "#3b82f6", text: "#12356d" },
    { fill: "#dcfce7", stroke: "#16a34a", text: "#124625" },
    { fill: "#ffedd5", stroke: "#f97316", text: "#7a2f10" },
    { fill: "#fde2e4", stroke: "#e11d48", text: "#7a1730" },
    { fill: "#e0f2fe", stroke: "#0ea5e9", text: "#0c3f5e" },
    { fill: "#ede9fe", stroke: "#8b5cf6", text: "#3d2376" },
  ],
};

const sectionFrames = [
  { x: 60, y: 200, w: 2280, h: 255, title: "Experience Layer", subtitle: "Creator-facing pages, shared panels, and deployment note", tone: palette.experience },
  { x: 60, y: 470, w: 2280, h: 270, title: "Application Layer", subtitle: "Next.js Route Handlers running in the Node.js runtime", tone: palette.api },
  { x: 60, y: 760, w: 2280, h: 380, title: "Domain Services", subtitle: "Workflow orchestration across content, media planning, rendering, and publishing", tone: palette.services },
  { x: 60, y: 1160, w: 2280, h: 360, title: "Persistence, Execution, and Integrations", subtitle: "Data model, local assets, in-process jobs, and external systems", tone: palette.infra },
];

const cards = [
  {
    x: 110,
    y: 255,
    w: 300,
    h: 150,
    title: "Creator Browser",
    tag: "Actor",
    tone: palette.experience,
    body: [
      "Single-user local-first workflow.",
      "Starts onboarding, dashboard actions, preview playback, and job inspection.",
    ],
  },
  {
    x: 430,
    y: 245,
    w: 840,
    h: 175,
    title: "Next.js App Router Pages",
    tag: "UI",
    tone: palette.experience,
    body: [
      "/onboarding for niche, tone, timezone, curated or custom RSS, and YouTube connect.",
      "/dashboard for trend-led and media-led creation, asset upload, storyboarding, render control, metadata, and publishing.",
      "/jobs/[id] for job history, logs, status, and render artifacts.",
    ],
  },
  {
    x: 1290,
    y: 245,
    w: 550,
    h: 175,
    title: "Shared Client Components",
    tag: "React",
    tone: palette.experience,
    body: [
      "TrendPicker, UploadPanel, IdeaCards, StepSidebar, RenderPanel, MetadataPanel, YoutubePanel, JobStatusBadge.",
      "Client page code polls jobs and streams render previews from API routes.",
    ],
  },
  {
    x: 1860,
    y: 245,
    w: 380,
    h: 175,
    title: "Deployment Shape",
    tag: "Runtime",
    tone: palette.experience,
    body: [
      "Single deployable Next.js service.",
      "Dockerfile installs ffmpeg, ffprobe, fonts, and runs the production server on port 8080.",
      "SQLite and media files stay local to the instance.",
    ],
  },
  {
    x: 110,
    y: 530,
    w: 650,
    h: 165,
    title: "Profile, Sources, and Assets APIs",
    tag: "Routes",
    tone: palette.api,
    body: [
      "/api/profile, /api/sources",
      "/api/media, /api/media/[id], /api/renders/[id]",
      "User resolution, source management, upload persistence, ranged file streaming.",
    ],
  },
  {
    x: 780,
    y: 530,
    w: 760,
    h: 165,
    title: "Discovery and Planning APIs",
    tag: "Routes",
    tone: palette.api,
    body: [
      "/api/trends, /api/ideas",
      "/api/storyboard, /api/storyboard/preview, /api/media/relevance",
      "Trend clustering, idea generation, storyboard coverage analysis, preview hydration.",
    ],
  },
  {
    x: 1560,
    y: 530,
    w: 730,
    h: 165,
    title: "Render, Metadata, and Publish APIs",
    tag: "Routes",
    tone: palette.api,
    body: [
      "/api/render, /api/metadata, /api/schedule",
      "/api/youtube, /api/youtube/callback, /api/jobs/[id], /api/health",
      "Background render and upload jobs, metadata generation, scheduling, OAuth callback, health checks.",
    ],
  },
  {
    x: 110,
    y: 830,
    w: 500,
    h: 250,
    title: "Identity and Data Access",
    tag: "lib/",
    tone: palette.services,
    body: [
      "db.ts creates the shared Prisma client.",
      "user.ts resolves or creates the local user.",
      "default-sources.ts and profile-options.ts seed curated feeds and settings.",
      "media-assets.ts validates selected uploads against the active user.",
      "types.ts and utils.ts define shared contracts.",
    ],
  },
  {
    x: 630,
    y: 830,
    w: 520,
    h: 250,
    title: "Content Intelligence",
    tag: "lib/",
    tone: palette.services,
    body: [
      "rss.ts fetches RSS or Atom entries.",
      "trends.ts clusters entries into trend candidates and uses niche.ts for creator fit scoring.",
      "ideas.ts generates trend-led or media-led video angles, sometimes feeding storyboard planning for coverage context.",
      "metadata.ts and schedule.ts prepare publishing copy and recommended timing.",
    ],
  },
  {
    x: 1170,
    y: 830,
    w: 520,
    h: 250,
    title: "Storyboard and Media Planning",
    tag: "lib/",
    tone: palette.services,
    body: [
      "storyboard.ts analyzes uploaded media, scores coverage, selects beats, and hydrates generated previews.",
      "media-relevance.ts and editorial.ts support beat selection, overlays, subtitle timing, and formatting.",
      "generated-media.ts can fill coverage gaps with stills or Veo motion clips.",
    ],
  },
  {
    x: 1710,
    y: 830,
    w: 580,
    h: 250,
    title: "Rendering and Publishing",
    tag: "lib/",
    tone: palette.services,
    body: [
      "narration.ts builds TTS-backed audio tracks.",
      "ffmpeg.ts probes source media and invokes ffmpeg or ffprobe binaries.",
      "render.ts composes variants, overlays, subtitles, transitions, and generated support media.",
      "youtube.ts manages OAuth credentials and uploads completed renders.",
      "jobs.ts records queued, running, complete, and failed job state.",
    ],
  },
  {
    x: 110,
    y: 1230,
    w: 430,
    h: 225,
    title: "Prisma + SQLite",
    tag: "State",
    tone: palette.infra,
    body: [
      "schema.prisma models: User, Source, MediaAsset, Job, Render, OAuthCredential.",
      "Routes and services persist profile state, uploads, render outputs, OAuth tokens, and job logs here.",
    ],
  },
  {
    x: 560,
    y: 1230,
    w: 430,
    h: 225,
    title: "Local Filesystem",
    tag: "Assets",
    tone: palette.infra,
    body: [
      "uploads/<user>/<job> stores raw uploaded images and videos.",
      "uploads/<user>/generated-support and storyboard-preview hold AI-generated support assets.",
      "renders/<job> stores final mp4 variants and related temporary files.",
    ],
  },
  {
    x: 1010,
    y: 1230,
    w: 500,
    h: 225,
    title: "In-Process Background Jobs",
    tag: "Execution",
    tone: palette.infra,
    body: [
      "createJob() and runJobInBackground() back trends, ideas, render, and youtube-upload tasks.",
      "Logs and outputJson are written back to the Job table.",
      "Dashboard polling reads /api/jobs/[id] until completion and then surfaces outputs.",
    ],
  },
  {
    x: 1530,
    y: 1230,
    w: 760,
    h: 225,
    title: "External Systems and Local Binaries",
    tag: "Integrations",
    tone: palette.external,
    body: [
      "RSS or Atom feeds provide trend inputs through rss-parser.",
      "Gemini chat, image, TTS, and Veo video endpoints power idea generation, metadata, narration, and support media.",
      "Google OAuth 2.0 and YouTube Data API v3 handle account connection and upload.",
      "Local ffmpeg and ffprobe binaries handle sampling, composition, subtitle burn-in, mixing, and final render packaging.",
    ],
  },
];

const arrows = [
  {
    points: [
      [410, 330],
      [430, 330],
    ],
    color: palette.experience.accent,
  },
  {
    points: [
      [850, 420],
      [850, 490],
    ],
    color: palette.api.accent,
    label: "fetch / submit",
    labelX: 880,
    labelY: 470,
  },
  {
    points: [
      [430, 610],
      [360, 610],
      [360, 830],
    ],
    color: palette.api.accent,
    label: "profile + uploads",
    labelX: 175,
    labelY: 660,
  },
  {
    points: [
      [1160, 610],
      [1160, 830],
    ],
    color: palette.api.accent,
    label: "planning calls",
    labelX: 1190,
    labelY: 720,
  },
  {
    points: [
      [1920, 610],
      [2000, 610],
      [2000, 830],
    ],
    color: palette.api.accent,
    label: "render + publish",
    labelX: 2018,
    labelY: 720,
  },
  {
    points: [
      [360, 1080],
      [325, 1080],
      [325, 1230],
    ],
    color: palette.services.accent,
  },
  {
    points: [
      [900, 1080],
      [900, 1230],
    ],
    color: palette.services.accent,
  },
  {
    points: [
      [1430, 1080],
      [1430, 1188],
      [1770, 1188],
      [1770, 1230],
    ],
    color: palette.services.accent,
    label: "AI coverage + previews",
    labelX: 1540,
    labelY: 1168,
  },
  {
    points: [
      [2000, 1080],
      [2000, 1230],
    ],
    color: palette.services.accent,
  },
  {
    points: [
      [1890, 695],
      [1890, 740],
      [1260, 740],
      [1260, 1230],
    ],
    color: palette.infra.accent,
    dashed: true,
    label: "queued background jobs",
    labelX: 1390,
    labelY: 725,
  },
  {
    points: [
      [760, 332],
      [650, 332],
      [650, 1320],
      [1010, 1320],
    ],
    color: palette.line,
    dashed: true,
    label: "job polling + asset playback",
    labelX: 530,
    labelY: 845,
  },
];

const workflowSteps = [
  "1. Onboard creator profile, timezone, RSS sources, and YouTube auth state.",
  "2. Ingest RSS trends or uploaded media assets.",
  "3. Generate idea candidates or a single media-led angle.",
  "4. Score storyboard coverage and generate missing support visuals when needed.",
  "5. Render three FFmpeg video variants with narration, subtitles, and overlays.",
  "6. Generate metadata and recommend publish timing.",
  "7. Upload the chosen render to YouTube or stay in mock mode.",
];

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapText(text, maxChars) {
  if (!text) {
    return [""];
  }

  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if (`${current} ${word}`.length <= maxChars) {
      current = `${current} ${word}`;
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function renderMultilineText({ x, y, lines, fontSize, lineHeight, fill, fontWeight = 400 }) {
  const tspans = lines
    .map((line, index) => {
      const dy = index === 0 ? 0 : lineHeight;
      return `<tspan x="${x}" dy="${dy}">${escapeXml(line || " ")}</tspan>`;
    })
    .join("");

  return `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}">${tspans}</text>`;
}

function renderSectionFrame(section) {
  const { x, y, w, h, title, subtitle, tone } = section;
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="32" fill="${palette.panel}" stroke="${tone.stroke}" stroke-width="2.5"/>`,
    `<rect x="${x + 24}" y="${y + 20}" width="12" height="${h - 40}" rx="6" fill="${tone.accent}"/>`,
    renderMultilineText({
      x: x + 56,
      y: y + 46,
      lines: [title],
      fontSize: 28,
      lineHeight: 32,
      fill: palette.ink,
      fontWeight: 700,
    }),
    renderMultilineText({
      x: x + 56,
      y: y + 80,
      lines: wrapText(subtitle, 90),
      fontSize: 19,
      lineHeight: 24,
      fill: palette.muted,
      fontWeight: 500,
    }),
  ].join("");
}

function renderCard(card) {
  const { x, y, w, h, title, tag, tone, body } = card;
  const bodyLines = body.flatMap((line) => wrapText(line, Math.max(24, Math.floor((w - 72) / 11.5))));

  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="28" fill="${tone.fill}" stroke="${tone.stroke}" stroke-width="2.2" filter="url(#shadow)"/>`,
    `<rect x="${x}" y="${y}" width="${w}" height="10" rx="28" fill="${tone.accent}"/>`,
    `<rect x="${x + w - 126}" y="${y + 22}" width="92" height="32" rx="16" fill="rgba(255,255,255,0.88)" stroke="${tone.stroke}" stroke-width="1.5"/>`,
    renderMultilineText({
      x: x + 28,
      y: y + 50,
      lines: wrapText(title, Math.max(20, Math.floor((w - 190) / 13))),
      fontSize: 28,
      lineHeight: 32,
      fill: palette.ink,
      fontWeight: 700,
    }),
    renderMultilineText({
      x: x + w - 108,
      y: y + 43,
      lines: [tag],
      fontSize: 16,
      lineHeight: 18,
      fill: tone.accent,
      fontWeight: 700,
    }),
    renderMultilineText({
      x: x + 28,
      y: y + 94,
      lines: bodyLines,
      fontSize: 21,
      lineHeight: 28,
      fill: palette.muted,
      fontWeight: 500,
    }),
  ].join("");
}

function renderArrow({ points, color, dashed = false, label, labelX, labelY }) {
  const polyline = points.map(([x, y]) => `${x},${y}`).join(" ");
  const dashAttrs = dashed ? ` stroke-dasharray="12 12"` : "";
  const labelMarkup =
    label && typeof labelX === "number" && typeof labelY === "number"
      ? `<text x="${labelX}" y="${labelY}" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="700" fill="${color}">${escapeXml(label)}</text>`
      : "";

  return `<polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"${dashAttrs} marker-end="url(#arrow-${color.slice(1)})"/>${labelMarkup}`;
}

function renderWorkflowStrip() {
  const baseX = 90;
  const baseY = 1565;
  const gap = 16;
  const stepWidth = 313;
  const stepHeight = 124;

  const pills = workflowSteps
    .map((step, index) => {
      const tone = palette.workflow[index];
      const x = baseX + index * (stepWidth + gap);
      const y = baseY;

      return [
        `<rect x="${x}" y="${y}" width="${stepWidth}" height="${stepHeight}" rx="28" fill="${tone.fill}" stroke="${tone.stroke}" stroke-width="2.5"/>`,
        renderMultilineText({
          x: x + 24,
          y: y + 40,
          lines: wrapText(step, 28),
          fontSize: 20,
          lineHeight: 25,
          fill: tone.text,
          fontWeight: 700,
        }),
      ].join("");
    })
    .join("");

  return [
    renderMultilineText({
      x: 90,
      y: 1540,
      lines: ["End-to-End Product Flow"],
      fontSize: 28,
      lineHeight: 32,
      fill: palette.ink,
      fontWeight: 700,
    }),
    pills,
  ].join("");
}

function markerDef(hex) {
  const id = `arrow-${hex.slice(1)}`;
  return `<marker id="${id}" viewBox="0 0 14 14" refX="10" refY="7" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M0,0 L14,7 L0,14 z" fill="${hex}"/></marker>`;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  const markers = [...new Set(arrows.map((arrow) => arrow.color))].map(markerDef).join("");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fff5df"/>
      <stop offset="52%" stop-color="${palette.bg}"/>
      <stop offset="100%" stop-color="#eaf5fb"/>
    </linearGradient>
    <radialGradient id="glow-left" cx="0%" cy="0%" r="100%">
      <stop offset="0%" stop-color="rgba(245,181,85,0.45)"/>
      <stop offset="100%" stop-color="rgba(245,181,85,0)"/>
    </radialGradient>
    <radialGradient id="glow-right" cx="100%" cy="0%" r="90%">
      <stop offset="0%" stop-color="rgba(76,162,219,0.34)"/>
      <stop offset="100%" stop-color="rgba(76,162,219,0)"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="rgba(16,32,50,0.12)"/>
    </filter>
    ${markers}
  </defs>

  <rect width="${width}" height="${height}" fill="url(#bg-gradient)"/>
  <circle cx="250" cy="200" r="320" fill="url(#glow-left)"/>
  <circle cx="2140" cy="140" r="360" fill="url(#glow-right)"/>
  <rect x="36" y="36" width="${width - 72}" height="${height - 72}" rx="40" fill="none" stroke="rgba(16,32,50,0.10)" stroke-width="2"/>

  ${renderMultilineText({
    x: 90,
    y: 88,
    lines: ["Creator Pilot Project Architecture"],
    fontSize: 46,
    lineHeight: 48,
    fill: palette.ink,
    fontWeight: 800,
  })}
  ${renderMultilineText({
    x: 90,
    y: 128,
    lines: wrapText(
      "Local-first Next.js monolith for trend-led and media-led video creation, storyboard planning, FFmpeg rendering, metadata generation, and optional YouTube publishing.",
      128,
    ),
    fontSize: 23,
    lineHeight: 29,
    fill: palette.muted,
    fontWeight: 500,
  })}
  ${renderMultilineText({
    x: 1860,
    y: 100,
    lines: ["Current repo layout"],
    fontSize: 22,
    lineHeight: 24,
    fill: palette.ink,
    fontWeight: 700,
  })}
  ${renderMultilineText({
    x: 1860,
    y: 132,
    lines: wrapText("App Router UI + Route Handlers + Prisma + local media files + Gemini/Veo + YouTube APIs.", 46),
    fontSize: 18,
    lineHeight: 22,
    fill: palette.muted,
    fontWeight: 600,
  })}

  ${sectionFrames.map(renderSectionFrame).join("")}
  ${cards.map(renderCard).join("")}
  ${arrows.map(renderArrow).join("")}
  ${renderWorkflowStrip()}

  ${renderMultilineText({
    x: 90,
    y: 1760,
    lines: ["Generated from the checked-in project structure and runtime code paths."],
    fontSize: 17,
    lineHeight: 20,
    fill: palette.muted,
    fontWeight: 600,
  })}
</svg>`;

  await fs.writeFile(svgPath, svg, "utf8");
  await sharp(Buffer.from(svg))
    .jpeg({ quality: 92 })
    .toFile(jpgPath);

  console.log(`Wrote ${path.relative(process.cwd(), svgPath)}`);
  console.log(`Wrote ${path.relative(process.cwd(), jpgPath)}`);
}

await main();
