import { promises as fs } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const width = 2400;
const height = 1800;
const outDir = path.join(process.cwd(), "docs", "architecture");
const svgPath = path.join(outDir, "creator-pilot-architecture.svg");
const jpgPath = path.join(outDir, "creator-pilot-architecture.jpg");

const palette = {
  bg: "#f7f4ec",
  ink: "#112235",
  muted: "#56697f",
  panel: "rgba(255,255,255,0.72)",
  frame: "rgba(17,34,53,0.1)",
  line: "#35516e",
  creator: { fill: "#fff7ee", stroke: "#e7b77b", accent: "#c36a1e" },
  control: { fill: "#eef5ff", stroke: "#9db8f5", accent: "#2357c5" },
  agent: { fill: "#effaf5", stroke: "#93d2ba", accent: "#0f766e" },
  orchestrator: { fill: "#fff4d6", stroke: "#e2b74d", accent: "#8a5a00" },
  memory: { fill: "#f8efff", stroke: "#c6adea", accent: "#6d3bb7" },
  tools: { fill: "#eef8fb", stroke: "#9dcddd", accent: "#0f5f87" },
  infra: { fill: "#fff6ec", stroke: "#efc48c", accent: "#b86207" },
};

const sectionFrames = [
  {
    x: 60,
    y: 210,
    w: 2280,
    h: 220,
    title: "Creator App + Control Surface",
    subtitle: "The existing Next.js monolith remains intact. Route handlers and in-process jobs now hand work to an explicit orchestrator.",
    tone: palette.creator,
  },
  {
    x: 60,
    y: 455,
    w: 2280,
    h: 830,
    title: "Multi-Agent Control Plane",
    subtitle: "A central Orchestrator Agent owns workflow state and delegates control to specialized agents that wrap the current lib/ services.",
    tone: palette.control,
  },
  {
    x: 60,
    y: 1310,
    w: 2280,
    h: 420,
    title: "Memory, Tools, and Runtime Grounding",
    subtitle: "No invented infrastructure. Memory comes from Prisma + SQLite records, tools come from the current local-first runtime, and jobs still run in process.",
    tone: palette.infra,
  },
];

const cards = [
  {
    x: 110,
    y: 260,
    w: 460,
    h: 120,
    title: "Creator Workspace",
    tag: "UI",
    tone: palette.creator,
    body: [
      "/dashboard, /jobs/[id], and onboarding remain the control point for trend-led and media-led runs.",
      "The UI can now show live agent activity pulled from job logs.",
    ],
  },
  {
    x: 605,
    y: 248,
    w: 790,
    h: 145,
    title: "Next.js Route Handlers",
    tag: "API",
    tone: palette.creator,
    body: [
      "/api/trends, /api/ideas, /api/storyboard, /api/render, /api/metadata, and /api/youtube now call the orchestrator instead of stitching services inline.",
    ],
  },
  {
    x: 1430,
    y: 248,
    w: 810,
    h: 145,
    title: "Background Jobs + Local Runtime",
    tag: "Execution",
    tone: palette.creator,
    body: [
      "lib/jobs.ts still runs work in process and writes logs/outputJson into Prisma Job rows.",
      "That job log stream is the agent event bus for the current local-first setup.",
    ],
  },
  {
    x: 870,
    y: 540,
    w: 660,
    h: 170,
    title: "Orchestrator Agent",
    tag: "Control",
    tone: palette.orchestrator,
    body: [
      "Owns workflow state, decides the next agent, and writes explicit control-flow logs.",
      "Implements runTrendDiscoveryWorkflow(), runIdeaWorkflow(), runStoryboardWorkflow(), runRenderWorkflow(), runMetadataWorkflow(), and runPublishingWorkflow().",
      "Grounded in lib/agents/orchestrator.ts.",
    ],
  },
  {
    x: 120,
    y: 560,
    w: 340,
    h: 165,
    title: "Profile / Memory Agent",
    tag: "Agent",
    tone: palette.agent,
    body: [
      "Responsibility: load creator profile, source preferences, recent renders, and publish history.",
      "Tools: Prisma + SQLite (User, Source, Job, Render).",
    ],
  },
  {
    x: 120,
    y: 780,
    w: 340,
    h: 165,
    title: "Ideation Agent",
    tag: "Agent",
    tone: palette.agent,
    body: [
      "Responsibility: generate trend-led or media-led video angles using creator memory.",
      "Tools: Gemini structured prompting + linked media context.",
    ],
  },
  {
    x: 120,
    y: 1000,
    w: 340,
    h: 150,
    title: "Media Selection Agent",
    tag: "Agent",
    tone: palette.agent,
    body: [
      "Responsibility: resolve uploaded assets from IDs/paths and hand them to downstream agents.",
      "Tools: Prisma + local filesystem references.",
    ],
  },
  {
    x: 1570,
    y: 560,
    w: 340,
    h: 165,
    title: "Trend Discovery Agent",
    tag: "Agent",
    tone: palette.agent,
    body: [
      "Responsibility: sync sources, fetch RSS entries, cluster trends, and rank creator fit.",
      "Tools: RSS / trend feeds + niche scoring + LLM label cleanup.",
    ],
  },
  {
    x: 620,
    y: 795,
    w: 380,
    h: 180,
    title: "Storyboard Agent",
    tag: "Agent",
    tone: palette.agent,
    body: [
      "Responsibility: convert idea + media into beat coverage, previews, and render gates.",
      "Tools: Gemini/Veo preview generation + local storyboard assets.",
    ],
  },
  {
    x: 1030,
    y: 795,
    w: 380,
    h: 180,
    title: "Render Agent",
    tag: "Agent",
    tone: palette.agent,
    body: [
      "Responsibility: narration, FFmpeg composition, variant rendering, and persisted outputs.",
      "Tools: Gemini TTS/Veo + ffmpeg/ffprobe + /renders + storage wrapper.",
    ],
  },
  {
    x: 1570,
    y: 790,
    w: 340,
    h: 160,
    title: "Metadata Agent",
    tag: "Agent",
    tone: palette.agent,
    body: [
      "Responsibility: build YouTube title, description, tags, and publish timing guidance.",
      "Tools: Gemini metadata prompts + schedule helper.",
    ],
  },
  {
    x: 1570,
    y: 995,
    w: 340,
    h: 160,
    title: "Publishing Agent",
    tag: "Agent",
    tone: palette.agent,
    body: [
      "Responsibility: validate audio, resolve the selected render, and upload in live or mock mode.",
      "Tools: YouTube Data API + OAuth + stored render access.",
    ],
  },
  {
    x: 110,
    y: 1395,
    w: 720,
    h: 265,
    title: "Memory / Context Store",
    tag: "State",
    tone: palette.memory,
    body: [
      "Creator profile: User.niche, User.tone, User.timezone, enabled Source rows.",
      "Past outputs: Job.outputJson plus Render rows for recent render and upload history.",
      "Preferences: source mode, recent render format, and what the creator has already shipped.",
      "Grounded in the current Prisma + SQLite schema. No new distributed memory service is invented.",
    ],
  },
  {
    x: 860,
    y: 1395,
    w: 740,
    h: 265,
    title: "Agent Tools Layer",
    tag: "Tools",
    tone: palette.tools,
    body: [
      "RSS / trend sources for discovery.",
      "Gemini / Veo APIs for ideas, storyboard analysis, generated support media, narration, and metadata.",
      "FFmpeg / ffprobe for probing, composition, subtitles, and final renders.",
      "YouTube Data API for upload plus local media assets from /uploads and /renders.",
    ],
  },
  {
    x: 1630,
    y: 1395,
    w: 610,
    h: 265,
    title: "Monolith Runtime Grounding",
    tag: "Runtime",
    tone: palette.infra,
    body: [
      "Single Next.js App Router service with Route Handlers.",
      "Prisma + SQLite stay local to the instance.",
      "Jobs still run in process via lib/jobs.ts.",
      "Cloud Run remains single-instance / demo oriented, with optional render storage bucket support.",
    ],
  },
];

const arrows = [
  {
    points: [
      [570, 320],
      [605, 320],
    ],
    color: palette.creator.accent,
  },
  {
    points: [
      [1395, 320],
      [1430, 320],
    ],
    color: palette.creator.accent,
  },
  {
    points: [
      [1000, 394],
      [1000, 450],
      [1200, 450],
      [1200, 540],
    ],
    color: palette.control.accent,
    label: "job starts",
    labelX: 1030,
    labelY: 438,
  },
  {
    points: [
      [870, 625],
      [460, 625],
    ],
    color: palette.orchestrator.accent,
    label: "load context",
    labelX: 580,
    labelY: 608,
  },
  {
    points: [
      [1200, 710],
      [1200, 770],
      [290, 770],
      [290, 780],
    ],
    color: palette.orchestrator.accent,
    label: "delegate idea run",
    labelX: 640,
    labelY: 754,
  },
  {
    points: [
      [1200, 710],
      [1200, 975],
      [460, 975],
    ],
    color: palette.orchestrator.accent,
    label: "resolve uploads",
    labelX: 680,
    labelY: 957,
  },
  {
    points: [
      [1530, 625],
      [1570, 625],
    ],
    color: palette.orchestrator.accent,
    label: "discover trends",
    labelX: 1365,
    labelY: 608,
  },
  {
    points: [
      [1195, 710],
      [1195, 795],
      [810, 795],
    ],
    color: palette.orchestrator.accent,
    label: "plan storyboard",
    labelX: 990,
    labelY: 778,
  },
  {
    points: [
      [1205, 710],
      [1205, 795],
      [1220, 795],
    ],
    color: palette.orchestrator.accent,
    label: "render approved plan",
    labelX: 1230,
    labelY: 778,
  },
  {
    points: [
      [1530, 710],
      [1670, 710],
      [1670, 790],
    ],
    color: palette.orchestrator.accent,
    label: "package metadata",
    labelX: 1545,
    labelY: 735,
  },
  {
    points: [
      [1530, 700],
      [1740, 700],
      [1740, 995],
    ],
    color: palette.orchestrator.accent,
    label: "publish selected render",
    labelX: 1550,
    labelY: 688,
  },
  {
    points: [
      [1910, 635],
      [2040, 635],
      [2040, 1395],
    ],
    color: palette.line,
    dashed: true,
    label: "route handlers + jobs",
    labelX: 2050,
    labelY: 1010,
  },
  {
    points: [
      [290, 725],
      [290, 1395],
    ],
    color: palette.memory.accent,
    label: "read / write memory",
    labelX: 320,
    labelY: 1070,
  },
  {
    points: [
      [810, 1530],
      [840, 1530],
    ],
    color: palette.tools.accent,
    dashed: true,
    label: "feedback loop",
    labelX: 715,
    labelY: 1510,
  },
  {
    points: [
      [830, 1530],
      [830, 1080],
      [460, 1080],
    ],
    color: palette.memory.accent,
    dashed: true,
    label: "publishing → memory → ideation",
    labelX: 440,
    labelY: 1480,
  },
  {
    points: [
      [1910, 1080],
      [1910, 1520],
      [830, 1520],
    ],
    color: palette.memory.accent,
    dashed: true,
  },
  {
    points: [
      [810, 910],
      [460, 910],
    ],
    color: palette.agent.accent,
    label: "selected angle",
    labelX: 560,
    labelY: 892,
  },
  {
    points: [
      [460, 1080],
      [620, 1080],
      [620, 910],
    ],
    color: palette.agent.accent,
    label: "selected assets",
    labelX: 470,
    labelY: 1062,
  },
  {
    points: [
      [1000, 885],
      [1030, 885],
    ],
    color: palette.agent.accent,
    label: "approved storyboard",
    labelX: 865,
    labelY: 868,
  },
  {
    points: [
      [1410, 885],
      [1570, 885],
    ],
    color: palette.agent.accent,
    label: "render outputs",
    labelX: 1440,
    labelY: 868,
  },
  {
    points: [
      [1740, 950],
      [1740, 995],
    ],
    color: palette.agent.accent,
    label: "title + schedule",
    labelX: 1760,
    labelY: 980,
  },
  {
    points: [
      [1200, 1165],
      [1200, 1395],
    ],
    color: palette.tools.accent,
    dashed: true,
    label: "tool calls",
    labelX: 1230,
    labelY: 1280,
  },
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
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="34" fill="${palette.panel}" stroke="${tone.stroke}" stroke-width="2.5"/>`,
    `<rect x="${x + 24}" y="${y + 24}" width="12" height="${h - 48}" rx="6" fill="${tone.accent}"/>`,
    renderMultilineText({
      x: x + 56,
      y: y + 50,
      lines: [title],
      fontSize: 30,
      lineHeight: 34,
      fill: palette.ink,
      fontWeight: 800,
    }),
    renderMultilineText({
      x: x + 56,
      y: y + 86,
      lines: wrapText(subtitle, 118),
      fontSize: 19,
      lineHeight: 23,
      fill: palette.muted,
      fontWeight: 500,
    }),
  ].join("");
}

function renderCard(card) {
  const { x, y, w, h, title, tag, tone, body } = card;
  const bodyLines = body.flatMap((line) => wrapText(line, Math.max(24, Math.floor((w - 70) / 11.5))));

  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="28" fill="${tone.fill}" stroke="${tone.stroke}" stroke-width="2.2" filter="url(#shadow)"/>`,
    `<rect x="${x}" y="${y}" width="${w}" height="10" rx="28" fill="${tone.accent}"/>`,
    `<rect x="${x + w - 124}" y="${y + 20}" width="92" height="32" rx="16" fill="rgba(255,255,255,0.9)" stroke="${tone.stroke}" stroke-width="1.5"/>`,
    renderMultilineText({
      x: x + 26,
      y: y + 48,
      lines: wrapText(title, Math.max(20, Math.floor((w - 170) / 13))),
      fontSize: 28,
      lineHeight: 32,
      fill: palette.ink,
      fontWeight: 700,
    }),
    renderMultilineText({
      x: x + w - 105,
      y: y + 42,
      lines: [tag],
      fontSize: 16,
      lineHeight: 18,
      fill: tone.accent,
      fontWeight: 700,
    }),
    renderMultilineText({
      x: x + 26,
      y: y + 88,
      lines: bodyLines,
      fontSize: 19,
      lineHeight: 24,
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
      <stop offset="0%" stop-color="#fff9ef"/>
      <stop offset="48%" stop-color="${palette.bg}"/>
      <stop offset="100%" stop-color="#edf7fb"/>
    </linearGradient>
    <radialGradient id="glow-left" cx="0%" cy="0%" r="100%">
      <stop offset="0%" stop-color="rgba(241,183,100,0.40)"/>
      <stop offset="100%" stop-color="rgba(241,183,100,0)"/>
    </radialGradient>
    <radialGradient id="glow-right" cx="100%" cy="0%" r="90%">
      <stop offset="0%" stop-color="rgba(92,164,224,0.28)"/>
      <stop offset="100%" stop-color="rgba(92,164,224,0)"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="rgba(17,34,53,0.12)"/>
    </filter>
    ${markers}
  </defs>

  <rect width="${width}" height="${height}" fill="url(#bg-gradient)"/>
  <circle cx="250" cy="220" r="330" fill="url(#glow-left)"/>
  <circle cx="2140" cy="170" r="360" fill="url(#glow-right)"/>
  <rect x="34" y="34" width="${width - 68}" height="${height - 68}" rx="42" fill="none" stroke="${palette.frame}" stroke-width="2"/>

  ${renderMultilineText({
    x: 90,
    y: 95,
    lines: ["Creator Pilot Multi-Agent Architecture"],
    fontSize: 48,
    lineHeight: 52,
    fill: palette.ink,
    fontWeight: 800,
  })}
  ${renderMultilineText({
    x: 90,
    y: 138,
    lines: wrapText(
      "A grounded evolution of the current Next.js monolith: explicit orchestration, specialized agents, Prisma-backed memory, local job execution, and the same Gemini/Veo, FFmpeg, and YouTube integrations already present in the repo.",
      144,
    ),
    fontSize: 23,
    lineHeight: 29,
    fill: palette.muted,
    fontWeight: 500,
  })}

  ${sectionFrames.map(renderSectionFrame).join("")}
  ${cards.map(renderCard).join("")}
  ${arrows.map(renderArrow).join("")}

  ${renderMultilineText({
    x: 90,
    y: 1750,
    lines: ["Diagram generated from the checked-in project structure, route handlers, lib/agents layer, Prisma schema, and current local-first runtime model."],
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
