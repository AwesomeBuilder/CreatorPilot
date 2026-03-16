# RETRO

## Template

- Date:
- Summary:
- What went well:
- Mistakes:
- Better prompts next time:
- Action items:

## Session Log

### 2026-03-05

- Summary: Initial MVP implementation for Creator Pilot completed (onboarding, dashboard workflow, APIs, jobs, rendering, and YouTube integration with mock fallback).
- What went well:
  - Monorepo architecture stayed simple and local-first.
  - End-to-end path is functional with clear job polling.
  - Mock/live YouTube behavior is explicit and predictable.
- Mistakes:
  - No automated tests added yet.
  - FFmpeg pipeline is intentionally basic and may need tuning per source quality.
- Better prompts next time:
  - Provide sample media set + expected render style earlier.
  - Define exact success criteria for scheduling UX copy.
- Action items:
  - Add integration tests for API routes and job transitions.
  - Add render validation checks and richer error surface in UI.

### 2026-03-15

- Summary: Shipped commit `3e06cd3` with YouTube upload fixes, render preview support, automatic metadata generation after render, media relevance assessment, and a stronger multi-asset render path.
- What went well:
  - Root-caused the YouTube upload failure to `youtubeSignupRequired` and converted the raw `Unauthorized` error into actionable UI messaging.
  - Added a browser-accessible render preview path so variants can be reviewed before upload.
  - Tightened the workflow by auto-running metadata/schedule generation after render and pausing autopilot when media looks off-topic.
  - Improved render composition enough to move away from the single-static-asset behavior.
- Mistakes:
  - The render engine is still template-like; even after the improvements, the final video can feel basic and incomplete.
  - The scope of the patch grew from tactical fixes into early pipeline redesign, which made the session broader than ideal.
  - Media-fit assessment is better, but it is not yet a full storyboard/vision pipeline.
- Better prompts next time:
  - State upfront whether the goal is a tactical ship fix or a full quality pass on the content pipeline.
  - Provide 2-3 representative media sets plus an example of the target output style before changing the renderer.
  - Split pipeline work into explicit phases: media intelligence, storyboarding, renderer, generated fallback visuals.
- Action items:
  - Replace the current media-fit heuristic layer with vision-led asset/shot analysis.
  - Rebuild rendering around storyboard beats with proper shot selection, pacing, and caption layout.
  - Add optional generated support visuals for beats that lack usable source media.
