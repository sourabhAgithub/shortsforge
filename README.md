# ShortsForge

Make faceless YouTube Shorts on your own computer. It's free, there's no login, and it uses no paid services.

Five tools work today:

- **Ranking Video:** paste 3–10 clip links, give each one a caption, and get a 1080×1920 countdown Short. It
  has a bold two-line title at the top and a rank list down the side that fills in as each clip plays.
- **Multiple Clip Generator:** upload a voiceover and paste a scene-by-scene script. Each scene gets footage made
  from its description, and the app builds a finished Short with a title banner, big labels, captions and
  a ranking list.
- **Video Generator:** edit one video into a Short. Trim it, keep or mute its sound, add your own audio,
  make captions automatically from the speech, and put text anywhere on screen.
- **Voice Generator:** type a script, pick a language and voice, and download it as an MP3. It has hundreds of
  natural voices in over 70 languages, including Hindi, Tamil, Malayalam and Telugu.
- **Story Puppets:** pick a ready-made character or draw your own, give it actions like walk, wave or fall, and
  get a story video.

The other tools in the sidebar are marked "Coming soon".

---

## 1. One-time setup

### Install Python (required)

1. Go to <https://www.python.org/downloads/> and click the big yellow **Download Python** button.
2. Run the installer.
   - **Windows:** on the first screen, tick **"Add python.exe to PATH"**, then click *Install Now*.
   - **Mac:** click through the installer as normal.

You need Python 3.10 or newer.

### Node.js (usually not needed)

The interface comes pre-built, so you don't need Node. If you ever delete the `frontend/dist` folder, install
the LTS version from <https://nodejs.org> and the start script will rebuild it.

You also don't need to install **ffmpeg**, because one is downloaded automatically.

## 2. Start the app

- **Windows:** double-click **`start.bat`**.
- **Mac:** double-click **`start.command`**. The first time, macOS may block it. If so, right-click it,
  choose **Open**, then click **Open** again.
- **Linux:** run `./start.sh` in a terminal.

The first start takes a minute or two while it installs what it needs. After that it opens
<http://localhost:8000> in your browser.

**Keep the black window open while you use the app.** Close it to stop ShortsForge.

### Use it from your phone or tablet

The app works on small screens: the menu moves behind the ☰ button and the editors stack into one column.
The app still runs on your computer. Your phone just opens it over Wi-Fi:

1. Start it in phone mode from a terminal in the ShortsForge folder: `./start.sh --phone` on Mac/Linux, or
   `start.bat --phone` on Windows.
2. The window prints an address like `http://192.168.1.20:8000`. Open it in your phone's browser. The phone must be
   on the same Wi-Fi as the computer.
3. If it doesn't load, allow incoming connections for Python when your computer's firewall asks.

While phone mode is on, anyone on the same Wi-Fi can open the app, so only use it on a network you trust.
Without `--phone`, only this computer can open the app.

## 3. Make a ranking video

1. Click **Ranking Video**, then **Create Ranking Video**.
2. **Title:** type your title, for example `Ranking Best`, then press **Enter**, then `Parkour Fails`.
   Two lines look best. Pick a color, then click words (like *Parkour*) in the box underneath to highlight them.
3. **Clips:** in each **Rank** slot, paste a YouTube Shorts, Instagram Reel or TikTok link and press
   **Enter** (or the send button). The clip downloads and its thumbnail appears. Then type a short caption,
   like `Aura Lost`.
   - 5–7 clips work best. Use **Add rank** to add more (up to 10), or the trash icon to remove one (minimum 3).
   - Use the ↑/↓ arrows to move a clip to a different rank.
   - **✂ Edit clip** opens that clip's editor:
     - **Timeline:** the bar is the whole clip. Drag the blue part (or its edges) to choose what plays, or type
       the seconds. **Auto** goes back to playing from the start. A striped end means "max seconds" cuts it off.
     - **Crop:** zoom in, then move left/right and up/down to choose which part of the clip shows.
     - **Use this clip's sound:** turn it off to make just this clip silent.
   - The upload button lets you use a video file from your computer instead of a link.
4. **Playback order:** by default the clips play as a countdown (5 → 4 → 3 → 2 → 1). Turn on
   **Custom playback order** to **Shuffle** (#1 always stays last) or drag the ranks into any order.
5. **Style & timing:** choose the clip length, either *Up to max seconds* (default 8) or *Full clip (auto)*,
   which plays each clip's whole trimmed part. Choose *Fit + blur* or *Fill (crop)*, and pick the title size
   and colors.
6. **Sound:** keep the *Clips' original sound*, use *My audio only* (upload music or a voiceover), or
   *Both mixed*, and set the volumes. Your track loops if it's shorter than the video and fades out at the end.
7. **Live preview:** press Play to watch the finished video in the page, with your real clips, trims, crops,
   sound and the title and rank list. It updates as you edit. Click a rank or the bar to jump around.
8. Click **Generate Video**. When it finishes, watch it and click **Download MP4**.

All your videos are saved under **My Videos**. Projects save automatically, so you can close the app and
carry on later.

The estimated length shows above the Generate button. YouTube Shorts can be up to 3 minutes long, but ranking
videos usually do best under 60 seconds, so the app warns you when you go over.

## 4. Make a multiple clip video

1. Click **Multiple Clip Generator**, then **Create Multi-Clip Video**.
2. **Title:** shown in a banner at the top of the whole video. Pick a **Title color**, or pick a **Highlight words** color and click
   words to paint just those, e.g. *Tallest Mountains* in red on a yellow title.
3. **Voiceover:** upload your narration as an MP3 or WAV. The video will be exactly as long as this audio.
4. **Script:** paste a table like the one below and click **Parse into scenes**, or build it scene by scene
   in the **Scene editor**.

   ```
   | Time | Voiceover | On screen |
   |---|---|---|
   | 3–11s | #5 San Marino: 61 km², founded in 301 AD | Hilltop castle in the clouds, label "61 km²" |
   ```

   - Text in quotes in the *On screen* column becomes the big on-screen label. The rest describes the footage.
   - A voiceover starting with `#5 San Marino:` puts "San Marino" at #5 in the ranking list.
   - If you leave out the times, the audio is split by how many words each scene has.
   - Click the small picture box on a scene to use your own image or video for it.
   - **Framing** (per scene): how the picture fits the video. *Fill frame* crops the edges so the picture
     fills the space (default). *Fit whole image* shows everything, with a blurred or black background
     around it. *Full screen* covers the whole video including the title banner, which is ideal for a
     finished 9:16 graphic like an end slide.
   - **Image motion** (per scene): how a still image moves while it's on screen. Choose Auto (varies from
     scene to scene), Keep still, Zoom in, Zoom out, or Pan left/right/up/down. Video clips play as they are.
5. **Footage (step 1):** pick a source and click **Generate footage**. Each scene shows a thumbnail. Use
   **Regenerate** on any scene you don't like.
   - *AI generated* (default): an AI image for each scene. If that fails, stock footage. If that fails too,
     a moving colour gradient.
   - *Stock footage:* real videos and photos from Pixabay or Pexels (needs a free key, see below).
   - *My uploads only:* your own files, with gradients for any scene that has none.
6. **Music & effects:** optional background music (volume 12% by default), captions, the ranking list, and
   a whoosh sound on each scene change.
7. **Preview & timeline:** check and fine-tune the timing before rendering.
   - **Auto-sync to voiceover** listens to your audio, works out when each word is spoken, and times every
     scene change and caption to match. It takes a few seconds; the first time it also downloads a free
     speech model (about 140 MB). Everything runs on your computer.
   - Press **Play** to watch a live preview with your voiceover and music: title, footage, labels, ranking
     list and captions all play in sync.
   - **Scenes track:** drag the blue lines between scenes to change when the picture changes.
   - **Labels track:** each scene's big on-screen label shows for the whole scene by default. Drag it to
     move it, or drag its edges, to show it only at a particular moment. You can also type exact times in the
     scene's label box (or in the "Show from … to … s" fields in the Scene editor), or click
     **Show for whole scene** to go back.
   - **Captions track:** drag a caption to move it, or drag its edges to change when it appears and disappears.
   - **Show label / Show ranking list:** switch these off to hide the text on top of the image (the label box
     and the #1–#5 list) for that scene. The same switches are on each scene in the Scene editor.
   - **Show captions in this scene:** switch it off to have no captions while that scene is on screen (for
     example on the last image). The voiceover still plays. The same switch is on each scene in the Scene editor.
   - **Scene captions list:** edit the words and the exact show/hide times (in seconds) for the scene under the
     playhead, add or delete captions, or **Reset to automatic**.
8. **Render video (step 2):** watch the progress bar, then preview and **Download MP4**.

**About the free AI images.** Without a key, the free image service only allows about **one image every 45
seconds**, so a 7-scene video takes around 5 minutes to generate footage for. The progress text shows the
wait. To make it fast, add keys as described below.

### Optional API keys

Copy `.env.example` to a new file called `.env` in the same folder, fill in the keys you have, and restart
the app:

| Setting | What it does | Where to get it |
| --- | --- | --- |
| `POLLINATIONS_TOKEN` | Removes the 45-second wait between AI images and the small corner logo | <https://enter.pollinations.ai> |
| `PIXABAY_API_KEY` | Turns on stock footage (used when AI fails, or as the "Stock footage" source) | Sign up free at <https://pixabay.com>, then copy the key from <https://pixabay.com/api/docs/> |
| `ELEVENLABS_API_KEY` | Voice Generator: adds ElevenLabs voices that act out tags like `[whispers]` (paid per character, small free allowance) | <https://elevenlabs.io>, then Profile → API keys |
| `PEXELS_API_KEY` | Same as above, using Pexels (tried first if both are set) | <https://www.pexels.com/api/> (new keys paused at the moment) |

Without any keys, everything still works: free AI images (slow), with gradients as the fallback.

## 5. Edit one video (Video Generator)

1. Click **Video Generator**, then **Create Video**. The live preview sits on the right (below the steps on
   a phone). Its playhead is the time used by every **Now** and **Add … at** button.
2. **Name:** for My Videos and the downloaded file only. It isn't drawn on the video.
3. **Video:** upload one video (MP4, MOV or WebM).
   - **Framing:** *Fill frame* crops a landscape video to fill the 9:16 screen. *Fit whole video* shows all of
     it over a blurred or black background.
   - **Trim:** start and end in the original video. Caption and text times count from the trim start.
   - **Video sound:** switch it off to mute the video, or set its volume.
4. **External audio (optional):** a voiceover or music, mixed with the video's sound. Set its volume and when it
   **starts**. To hear only this audio, mute the video in step 3.
5. **Captions:** **Make captions** listens to the video's sound or the external audio and times each caption to
   the spoken words (2–3 words at a time). Paste the exact words first if you want your spelling. You can then
   edit any caption's words and times, add or delete captions, and set their size, position and colour. The switch
   at the top turns all captions on or off.
6. **Text on video:** add as many texts as you like. Each one has its own show time, position (**Across** /
   **Down**), size, colour and optional box behind it. Press Enter in the text box for a new line.
7. **Render video:** one 1080×1920 MP4, saved to My Videos.

## 6. Make a voiceover MP3 (Voice Generator)

1. Click **Voice Generator** (under *Create*).
2. **Script:** type or paste what should be said, up to 20,000 characters. Write it in the voice's language.
3. **Language** and **Voice:** pick a language, then a voice. **Female** / **Male** filters the list, and ▶
   plays a short sample that reads the start of your script. The app remembers your last voice.
4. **Tags (optional):** put directions in square brackets, e.g. `[whispers] Open the door. [long pause]`. The
   buttons under the script add them at the cursor. Tags are never read out:
   - **Free voices** turn `[pause]`, `[short pause]` and `[long pause]` into silence, and mood tags (`[whispers]`,
     `[softly]`, `[slowly]`, `[nervous]`, `[urgent]`, `[excited]`, `[sad]`, `[angry]`, `[serious]`) into slower or
     faster, higher or lower, quieter or louder speech until the next tag or the end of the line. They can't
     truly whisper or cry.
   - **ElevenLabs voices** act the tags out (real whispers, a nervous voice, sighs, laughs). See the key below.
5. **Speed** and **Pitch:** optional, free voices only. Speed +10% to +20% suits Shorts.
6. **Generate MP3**, then play it or click **Download MP3**. The file is named after the script's first words.
7. **Your voiceovers** keeps your 50 newest MP3s to play, download again or delete.

The free voices come from Microsoft's online text-to-speech service (the same one as Edge's "Read aloud"), so
this tool needs an internet connection. No account or API key is needed. For Indian names and words in an
English script, the *English (India)* voices (Neerja, Prabhat) pronounce them best.

**ElevenLabs (optional, paid):** for the most natural, emotional voices, add `ELEVENLABS_API_KEY` to your `.env`
file (see *Optional API keys*) and restart. Its voices appear first in the **Language** list as
*★ ElevenLabs*. They speak any language, and ▶ plays their ready-made sample without using credits. ElevenLabs
charges per character of script; its free plan only covers a few minutes a month. To use an MP3 in a video, upload it as
the voiceover in the Multiple Clip Generator or as external audio in the Video Generator.

## 7. Make a story video (Story Puppets)

1. Click **Story Puppets**, then **Create Story**. The live preview sits on the right (below on a phone).
2. **Your characters:** use **Add person** for more people, click a person to work on them, and press the **×** on a
   person to remove just them. For each one, click a ready-made character (Stick figure, Girl, Boy, Mother, Father or Grandma), then
   change anything you like, or draw every part yourself. Pick a **body part**, then use the pen, circle, box or
   line in any colour. Stay inside the blue box: the dot is the joint that part turns around. Switch the **View** to
   **Side** to change how the character looks from the side; a blank side part borrows the front drawing. The preview shows whichever view you're
   drawing until you press play. **Hair** is drawn behind the body, for long hair, and recolouring it changes all the character's hair.
   **Attachments** add a hat, glasses, a moustache or beard, a tie or scarf, a backpack, or something to carry.
   Click one again to take it off. To change a colour, turn on the **Fill** tool, pick a body part and click a colour, or
   click a part on the figure: it changes in the front and side views together. The pen, shapes and eraser change only the view you see.
3. **What happens:** for the selected person, add actions in order (Stand, Walk, Run, Wave, Nod, Tremble, Point, Cheer, Jump, Sit down, Fall
   over) and set how long each lasts. Turn on **Move across the screen** to walk the character to a new spot.
   **Faces** is Automatic by default: sideways when walking or moving, towards the camera otherwise. Pick Front, Left
   or Right to choose yourself. The character flips like a paper cut-out when it turns. Everyone starts together, and
   anyone who finishes early holds their last pose. To make someone wait, give them a Stand action first.
4. **Scene:** sky and ground colours. Under **Add to the scene**, add houses, trees, a car, a moon and more. Each one
   has its own position, size, flip and in-front-of-people switch, and its own remove button.
5. **Render video:** a 1080×1920 MP4 saved to My Videos.

There's no voice yet. Scene changes, voiceover and captions come next.

## 8. Fixing download problems

**"The site asked for a login or is rate-limiting downloads" (common with Instagram)**

1. Open your normal browser (Chrome, Edge, Firefox, Safari or Brave) and log in to Instagram.
2. In ShortsForge, go to **Settings → Use cookies from my browser** and pick that browser.
3. **Close that browser completely**, then try the link again.

- **Safari on Mac:** open System Settings → Privacy & Security → Full Disk Access, and turn it on for **Terminal**.
- **Chrome/Edge on Windows:** these browsers lock their cookies while open, so close them before downloading.

**"This video is private" or "unavailable":** the post was deleted, is private, or the link has a typo.

**"The site blocked the download or changed its layout":** close the black window and start the app
again. It updates its downloader every time it starts.

**Nothing happens or "Can't reach ShortsForge":** the black window was closed. Start the app again.

## Put it online (Render)

The repository includes a `Dockerfile` and a `render.yaml` Blueprint for [Render](https://render.com).

1. Push this folder to a GitHub repository (private is fine).
2. In the Render dashboard choose **New → Blueprint**, connect the repository and select it.
3. Render asks for the values marked secret:
   - **APP_PASSWORD** (required): the password for the login prompt. The username is `admin` (change
     **APP_USERNAME** to use another one).
   - **PIXABAY_API_KEY** and **POLLINATIONS_TOKEN** are optional, the same as in `.env` locally.
4. Click **Apply**. The first build takes about 5–10 minutes. The app then runs at
   `https://shortsforge-xxxx.onrender.com`. Every push to the repository redeploys it.

Things to know about the online version:

- **The Free plan keeps nothing.** Projects, uploads and videos are deleted whenever the service
  restarts, redeploys or goes to sleep (after about 15 minutes without visits). Download your
  videos right after rendering. To keep files, switch to a paid plan and add a disk mounted at
  `/app/data`.
- **Free has 512 MB of memory.** Long renders or Auto-sync can run out, and the service then restarts.
  A plan with 2 GB of memory is the reliable choice. The first visit after sleeping takes about a minute.
- **Link downloads may fail.** YouTube, Instagram and TikTok often block servers in data centers.
  Uploading the clip file works instead.
- To use your own domain, open the service's **Settings → Custom Domains** in Render and add the DNS
  record it shows.

## Where things are stored

Everything stays in the `data` folder next to this file:

| Folder | What's in it |
| --- | --- |
| `data/downloads/` | downloaded clips (reused, so the same link isn't downloaded twice) |
| `data/projects/` | your projects (JSON, one folder per tool) |
| `data/aivideo/` | Multiple Clip Generator uploads and generated footage, one folder per project (deleted with the project) |
| `data/videogen/` | Video Generator videos and audio, one folder per project (deleted with the project) |
| `data/puppet/` | Story Puppets drawings, one folder per project (deleted with the project) |
| `data/voiceover/` | Voice Generator MP3s (the 50 newest are kept) |
| `data/outputs/` | finished videos and their thumbnails |

Delete `data/downloads` any time to free up space. Projects will re-download their clips when you generate.

Only download videos you have the right to use.

---

## For developers

```
backend/app/
  main.py            FastAPI app: shared API (downloads, jobs, settings, videos) + serves the UI
  downloader.py      yt-dlp wrapper (no-watermark formats, URL cache, friendly errors)
  ffmpeg_util.py     bundled ffmpeg (imageio-ffmpeg) with system fallback, probing
  jobs.py            background jobs polled by the UI
  tools/__init__.py  tool registry (backend routers)
  tools/ranking/     models, Pillow overlay drawing, ffmpeg render pipeline, API
  tools/aivideo/     script parser, footage providers (AI / Pexels / Pixabay / gradient), overlays,
                     render, auto-sync (faster-whisper word timings), API
  tools/videogen/    single-video editor: trim/framing, sound mix, text and caption overlays,
                     auto captions (reuses aivideo's speech recognition), API
  tools/voiceover/   text to speech MP3s: edge-tts voices, optional ElevenLabs (elevenlabs.py), delivery
                     tags turned into pauses + prosody for edge-tts (tags.py), saved history, API
  tools/puppet/      paper-cut puppets: motion library + pose timeline (motions.py; the preview draws
                     these same poses), Pillow frames piped to FFmpeg (render.py), API
  textdraw.py        outlined text with colour emoji (uses the system emoji font)
frontend/src/
  tools/registry.tsx tool list shown in the sidebar/dashboard
  tools/ranking/     ranking editor UI; layout.ts mirrors overlay.py for the live preview
  tools/aivideo/     AI video editor UI; PreviewFrame + layout.ts mirror the renderer for the live preview
  components/        pieces shared by the tools (Section, ToolHome, RenderDialog, Switch)
assets/fonts/        Montserrat Black (SIL OFL), used for the video text and the preview
```

- **Add a tool:** create `backend/app/tools/<tool>/api.py` with a `router` and register it in
  `tools/__init__.py`. Then create `frontend/src/tools/<tool>/` and switch its entry in `registry.tsx` to
  `status: "ready"` with a `component`.
- **Render pipeline:** each clip is rendered as its own segment. A segment is the clip scaled into a 1080×1500
  area (fit + blur or fill), a PNG overlay with the title band and rank list drawn by Pillow, and audio
  normalized with loudnorm (or silence for clips with none). The segments are then joined with the concat
  demuxer into H.264/AAC MP4 at 30 fps.
- **Tests:** `.venv/bin/python -m pytest backend/tests`. They generate sample clips with ffmpeg, render
  them, and check the frames and audio. No internet needed.
- **UI dev server:** run the backend, then `cd frontend && npm run dev`. Vite proxies `/api` to port 8000.
  Run `npm run build` before shipping.
