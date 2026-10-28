# Reference notes (researched 2026-10-28)

Reference product: viblo.ai, an AI tool for faceless short-form videos. Only the public landing
page can be read. The app itself (dashboard, editor) sits behind a login, and its routes return 404
without a session. The editor workflow below therefore comes from the walkthrough description in the spec.
We copy **layout and workflow only**. No logo, brand name or marketing copy is reused, and the app is
called **ShortsForge**.

## What the landing page shows

- **Navigation:** a top nav (Home, Features dropdown, Reviews, Pricing, Blog, Login, and a primary "Try" button).
  The logged-in app is described as a dashboard of tools, and we use a left sidebar for it, which is the
  usual pattern for this kind of SaaS.
- **Tool suite** (grouped on the site into three groups):
  - Content creation: Video Ranking, Video Commentary, AI Video Generator, AI Image Generator
  - Editing / automation: Auto Clipping, Split Screen Layouts, Project Editor, Auto Highlights
  - Voice and text: AI Voiceover, AI Voice Narration, Video Transcriber, Video Ranking Insights
  - Footer extras: Text Story, Video Story. The FAQ also mentions an Ideation Generator and a Script Enhancer.
- **Visual style** (from their stylesheet):
  - Font: Inter, with heavy uppercase display headings.
  - Accent: royal blue `#1941e3`, plus a lighter indigo `rgb(86,105,255)` and a sky blue `rgb(75,181,255)`
    used in gradients. Amber `#FBBF24` for badges.
  - Near-black `#0f0f11` panels with translucent white borders (`rgba(255,255,255,.1)`).
  - Card radius 12–16px, pill-shaped (50px) buttons, many circular icon rings.
  - The landing page is mostly light. Our app uses a **dark theme by default** (spec), built from those
    same near-black and blue tokens.

## Ranking tool workflow (from walkthrough, source of truth)

1. The home screen has a tool card "Video Ranking" with a "Start Ranking" button.
2. **Title editor:** type the title. Enter splits it into 2 lines (ideal). Click words to highlight keywords
   in a chosen color (teal, red, light blue, …). Other words stay white.
3. **Rank slots** "Rank 1…N": paste a URL, then send. The clip downloads without a watermark and shows a
   thumbnail. Each slot has a short caption ("Aura Lost", "Crocodile").
   N = 3–10, default 5, with a hint that 5–7 performs best.
4. **Playback order:** countdown by default (5→4→3→2→1). A "Custom playback order" toggle reveals Shuffle
   plus drag-to-reorder. Shuffle keeps #1 last.
5. **Generate Video.**

## Output format decisions

- 1080×1920, 30 fps, H.264 + AAC. A black title band at the top (2 lines, keyword colors, thick outline)
  sits above the clip area. The rank list overlay runs down the left side of the clip area.
- **Shorts length:** YouTube raised the Shorts maximum to **3 minutes** (October 2024). The app warns
  softly above 60 s, because short ranking videos perform best and Reels/TikTok feeds favour them, and
  strongly above 180 s.

## Our own naming for "coming soon" tools

Video Commentary, Text Story (fake chat), Reddit Story, Split Screen, Auto Clipping, Auto Highlights,
AI Voiceover, Auto Captions (transcriber), AI Video Generator, AI Image Generator.
