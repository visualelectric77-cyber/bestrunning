# BestRunning · media credits

Campaign set generated on 19 Oct 2026 with the owner's Magnific premium account
(magnific.com, the Freepik company). No stock was used. Everything is AI-generated except the
watch screens, which are real screenshots of the BestRunning watch app.

## Tools

| Step | Tool / model | Settings |
|---|---|---|
| Stills | **Google Nano Banana 2.1** in Magnific Image Generator. It was the newest Google photoreal model in the list; Nano Banana Pro and Magnific One were also offered. | 2K output (2752×1536 / 1536×2752 / 1856×2304), 100 credits per image |
| Video | **Kling 3.0** in Magnific Video Generator. It was the newest Kling listed; Kling 2.6 was also offered. | 1080p, 5 s, 24 fps, sound off. Loops use the same still as start and end frame. |
| Watch UI | Real screenshots from the BestRunning watchOS app (DEBUG demo mode `-BRDemo clase/pulso`), taken in the «Apple Watch Ultra 3 (49mm)» simulator at 422×514 px | Composited with Python/OpenCV: glass detection, perspective warp, rounded mask, subtle glare. The UI is never redrawn by AI. |
| Post | ffmpeg + PIL | H.264 High, yuv420p, faststart, no audio track, 24→30 fps. Loop point picked by frame similarity, or a 0.5 s crossfade for the watch loop. Progressive JPEG ≤ 350 KB. |

## Shared art-direction prompt base (identical for every still)

> Photorealistic cinematic photograph, low-key lighting, deep blacks, high contrast, one subtle warm
> ember-orange rim light (#FF5A1F) as the only colour accent, everything else neutral black and charcoal,
> shallow depth of field, 50mm lens, very subtle film grain, real athletic person not a posing model,
> modern minimalist dark gym with matte-black treadmills, no logos, no text, no brand marks, no screens
> with writing, generous negative space.

Each image adds a subject sentence to this base, for example «Vertical frame: a real athletic woman in her
early 30s … mid-stride … upper third empty deep black space for a title».

## Files

| File | Source | Notes |
|---|---|---|
| hero-woman.jpg | Nano Banana 2.1 (Magnific) | 9:16, woman mid-stride, 3/4 view |
| hero-man.jpg | Nano Banana 2.1 (Magnific) | 9:16, man mid-stride, strongest ember rim |
| treadmill-detail.jpg | Nano Banana 2.1 (Magnific) | 16:9, lower legs + belt, side view. **Re-shot 19 Oct, 20:38**: the first take had the runner facing the rear roller, with the console behind him. The new take has the shoes pointing right, toward the motor hood and console uprights at the right edge; the rear roller is at the left. Picked from 4 variants; all 4 had the correct direction. |
| cat-intervals.jpg | Nano Banana 2.1 (Magnific) | 16:9, sprint |
| cat-endurance.jpg | Nano Banana 2.1 (Magnific) | 16:9, steady long run |
| cat-recovery.jpg | Nano Banana 2.1 (Magnific) | 16:9, calm walk. Second take: the first had the treadmill console facing away from the runner. |
| cat-tempo.jpg | Nano Banana 2.1 (Magnific) | 16:9, focused |
| empty.jpg | Nano Banana 2.1 (Magnific) | 16:9, empty treadmill. Second take: the first frame looked copper-coloured instead of black. |
| hero-loop.mp4 / .jpg | Kling 3.0 (Magnific), start = end = hero-woman still | 720×1280, 30 fps, 5.0 s seamless. The man version was rejected because Kling invented a small chest logo. |
| detail-loop.mp4 / .jpg | Kling 3.0 (Magnific), start = end = new treadmill-detail still | 1280×720, 30 fps, 5.0 s seamless (Kling frames 0–119; frame 120 repeats frame 0). **Re-made 19 Oct, 20:44** with the new still. The prompt states the direction explicitly: runner faces right toward the console, belt moves right to left. Picked from 2 takes. Frame-by-frame check: the shoes always point right, the planted foot travels left with the belt, and the swing foot comes forward to land on the right. |
| watch-wrist.jpg | Nano Banana 2.1 wrist shot + **real «Clase» screen** | 1080×1920. Watch shown is an Ultra-style 49 mm titanium case. |
| watch-product.jpg | Nano Banana 2.1 product shot + **real «Pulso» screen** | 1200×1500 |
| watch-loop.mp4 / .jpg | Kling 3.0 animation of the wrist still (start = end) + real «Clase» screen composited on every frame | 720×1280, 30 fps, 4.5 s. The watch is static in the clip, so the UI stays pixel-crisp. |

The clock on the watch screens reads the real time of capture (19:51/19:52). The simulator status-bar
override is not supported on watchOS.

## Credits spent

About **4,950 Magnific credits** in this session:

* 18 Nano Banana 2.1 images at 2K × 100 credits
* 7 Kling 3.0 clips (1080p, 5 s, sound off) × 450 credits

Account panel afterwards: 61,118 credits used this period, 178.8K available (Premium plan).
Nothing was bought or upgraded.

Direction fix, 19 Oct 20:36–20:45: about **1,300 more credits** (4 Nano Banana 2.1 images at 2K × 100, plus 2 Kling 3.0 clips × 450). Nothing was bought or upgraded.

**Direction check (19 Oct, 20:45).** Every still and 3 or more frames of every clip were checked for the runner facing away from the console, running backwards, impossible treadmill geometry, and hand or foot artefacts. Only treadmill-detail and detail-loop were wrong, and both were re-made. hero-woman, hero-man, cat-intervals, cat-endurance, cat-recovery, empty and hero-loop all face the console. cat-tempo, watch-wrist, watch-product and watch-loop show no treadmill direction.

## Licence notes (read before shipping)

* **Magnific Terms of Use** (magnific.com/legal/terms-of-use), checked on 19 Oct 2026:
  * §4.3: content made with the AI tools is governed by the separate **AI Products Terms and Conditions**
    (`#nav-ai-products`). I could not load that text automatically (HTTP 403), so **open it once while
    logged in and confirm commercial use of outputs for your plan**. Magnific/Freepik premium plans have
    so far allowed commercial use of AI outputs without attribution.
  * §6.2: Magnific's indemnity **does not cover AI-generated content**. If an output resembles a real
    person, brand or design, the risk is ours.
  * §8.1 and §9.3.2 cover premium **stock**: commercial use without attribution, plus restrictions (no
    resale where the asset is the main element, no use in trademarks or logos, no AI training). Not
    relevant here, because no stock was used.
* **Third-party model terms** (Google Nano Banana, Kling) apply through Magnific. Neither tool asks for
  attribution in the output.
* **People** are synthetic. No real person or likeness was requested. Do not caption them as real users.
* **Apple Watch:** the watch is an AI rendering of an Ultra-style device, with no Apple logo or wordmark.
  It is fine for the app's own marketing and web pages. **App Store screenshots and Apple-sanctioned
  marketing should use Apple's official device frames** (developer.apple.com/design/resources). Follow
  Apple's "Apple Watch" naming rules in any copy next to these images.
* **Logos and text:** every frame was checked for logos and gibberish text. The man hero video was
  rejected for this reason.
* `_sheet.jpg` is a review contact sheet. **Do not ship it.**
