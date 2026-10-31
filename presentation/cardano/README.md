# AeroGuard × Cardano — everything for the presentation

**▶ Video (2:20, voiced): [`AeroGuard-Cardano-video.mp4`](AeroGuard-Cardano-video.mp4)**, right here in this folder.

**Submission texts:** [`UPDATED-cardano-narrative.md`](UPDATED-cardano-narrative.md) (the story in 6 sections, for the site and Devfolio) · [`UPDATED-cardano-pitch-2-speakers.md`](UPDATED-cardano-pitch-2-speakers.md) (3-min pitch for two speakers, Mihail and Eskender).

## What's in this folder
| File | What it is | When to use it |
|---|---|---|
| **`index.html`** | The slides: 10 slides with videos and QR codes | On stage. Open it, press **F** for fullscreen, use **→** to advance |
| **`SPEAKER-NOTES.md`** | **What to say on each slide**: English text plus a Russian translation, about 2½ min | Rehearse before the pitch. **N** shows the text under the slide |
| **[`AeroGuard-Cardano-video.mp4`](AeroGuard-Cardano-video.mp4)** | **The video**: 2:20, 1080p, voiced (EN); the same file as `web/media/cardano.mp4` | Edit it into your video or play it if the slides won't open |
| **`VIDEO-SCRIPT.md`** | **What to say over the video**: timecodes, what is on screen, EN text, RU translation | For recording the voice-over |
| `DEMO.md` | How to show a live payment on stage, and what to do if something breaks | 30 min before the pitch |
| `open-presentation.command` | Mac: double-click it to open the slides | — |
| `img/`, `media/` | QR codes and backup copies of the videos for the slides | Used by the slides, nothing to do |

The ten separate clips for editing are in [`../../cardano/video/`](../../cardano/video/), numbered 01–10.

## How to open
1. Update your local copy to the latest `main` (older copies don't have this folder):
   ```bash
   cd ~/aeroguard-run && git fetch -q origin main && git checkout -q -f FETCH_HEAD
   ```
2. Double-click `open-presentation.command`, or open `index.html` in Chrome or Safari.
3. Keys:
   - **→** or Space: next slide.
   - **←**: previous slide.
   - **F**: fullscreen.
   - **N**: speaker notes.

The slides work offline, but only from inside the repository: they take their videos from `../../cardano/video/`.
