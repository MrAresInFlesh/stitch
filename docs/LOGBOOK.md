# LOGBOOK

## Threshold slider + SVG download — 2026-09-23

### What we did

User asked for a threshold slider (bounded, not too high) on the SVG
trace step, plus the ability to download the traced SVG directly.

- Confirmed potrace's actual "threshold" knob is `-k`/`--blacklevel`
  (0-1, default 0.5) via `potrace --help` before assuming a flag name.
- Backend: `_trace_to_svg()` takes a `threshold` param, passed as `-k`
  to potrace; `/trace` and `/convert` accept `threshold: float =
  Form(THRESHOLD_DEFAULT)`, clamped server-side to
  `[THRESHOLD_MIN, THRESHOLD_MAX]` regardless of what the client sends.
  Verified with a gradient test image that the flag genuinely shifts the
  traced boundary (x=105 → 255 → 330 across k=0.2/0.5/0.65) and that an
  out-of-range client value (5.0) correctly clamps to 330 (= 0.65's
  result) rather than being passed through raw.
- While picking `THRESHOLD_MAX`, went looking for a real pathological
  case to justify the cap (rather than picking a number by feel) — see
  HOTSPOT-007: found that dense continuous grayscale noise (unlike the
  sparse speckle tested for HOTSPOT-006) can hit 100-170K traced
  coordinates at almost any blacklevel, including the 0.5 default, even
  at the 600px resolution cap. This surfaced a scary-looking false alarm
  (an early test of this case appeared to hang 17+ minutes, suggesting
  the HOTSPOT-005 timeout fix was broken) that turned out to be a test-
  environment artifact (a competing CPU-bound process I'd left running
  against the same container) — a clean isolated retest confirmed the
  90s timeout genuinely fires correctly (90.04s, clean 422). Decided the
  existing timeout is the right backstop for this too, rather than
  trying to also bound blacklevel by complexity — documented as
  HOTSPOT-007 rather than silently dropped once resolved.
- Frontend: new `ThresholdSlider.tsx` (0.2-0.65 range, mirroring the
  backend constants in a comment), wired into `App.tsx`'s trace step.
  `api.ts`'s `traceFile()` now takes and sends `threshold`.
  `SvgPreview.tsx` gained a "↓ Download SVG" button (reuses the same
  object URL already created for the `<img>` preview) alongside
  "Continue to DST", so the traced SVG is downloadable independent of
  whether the user continues to DST.
- Verified the whole thing through the real dev proxy path: trace with
  `threshold=0.6` → `200`, size preserved (`40.00mm`) → stitch → `200`,
  valid DST/PES/threadlist. `npx tsc -b` and `npm run build` clean.

### Why we did it this way

Picking a threshold ceiling "by feel" would have repeated the exact
mistake from earlier in this session (assuming a safe-looking parameter
without testing it against an adversarial input). Went and found a real
pathological case for blacklevel specifically, the same way
`TRACE_MAX_DIMENSION` was validated, rather than assuming the earlier
resolution fix made every downstream parameter automatically safe.

When the timing test looked broken (17+ minutes), the instinct to
immediately "fix" `CONVERT_TIMEOUT_SECONDS` was wrong — isolating the
variable first (bare `subprocess.run` outside FastAPI, then a from-
scratch container) found the actual cause was the test method, not the
code. Worth remembering: an alarming result from a long-running dev
session with lots of accumulated state (multiple containers, concurrent
`docker exec` calls) deserves a clean-room retest before it's trusted.

### Traps & problems encountered

- The 17-minute false alarm, detailed above and in HOTSPOT-007 — cost
  significant time to run down, but the alternative (shipping a
  "fix" for a mechanism that wasn't actually broken, or worse, wrongly
  concluding the whole timeout approach was unreliable) would have been
  worse.
- My first synthetic "noisy photo" test case (sparse per-pixel speckle
  over a solid blob, from the HOTSPOT-006 session) is NOT representative
  of all noisy-image complexity — dense continuous grayscale noise
  behaves differently and needed its own separate test to catch.

### Current state

Threshold slider and SVG download both live in `dev.sh`'s stack,
verified end-to-end through the real proxy path. `docs/HOTSPOTS.md`
HOTSPOT-007 records the dense-noise finding and the false-alarm
investigation; the known concurrent-request queueing limitation
(single blocking worker) is noted there as an open, unfixed
architectural limitation, not a hang risk.

---

## Two-step workflow + step feedback — 2026-09-23

### What we did

User reported "nothing happens, still taking forever" after the
resolution-normalization fix. Checked the backend container's logs
before assuming the fix had failed: only one `POST /convert` in the
log, and it was `200 OK` — the conversion had actually succeeded
quickly. The real problem was the frontend: a single opaque
"PROCESSING…" state gave no indication that anything had happened, so a
fast, successful conversion *felt* indistinguishable from a hang.

Restructured around two explicit steps instead of one opaque one, per
the user's request:

- Split the backend: `POST /trace` (PNG/SVG → normalized/traced SVG
  only) and `POST /stitch` (traced SVG → DST/PES/threadlist zip).
  `POST /convert` kept as a thin convenience wrapper that calls both in
  sequence (`_trace_to_svg()` / `_stitch_to_zip()` factored out and
  shared by all three routes) — useful for direct API callers, not used
  by the frontend anymore.
- Frontend: `DropZone` → **Convert to SVG** button → `POST /trace` →
  new `SvgPreview` component renders the traced result (via an `<img>`
  + object URL, not `dangerouslySetInnerHTML` — images never execute
  embedded script content even though potrace's output never has any,
  free insurance either way) → **Continue to DST** button →
  `POST /stitch` → existing `ResultCard`.
- `StatusBar` rewritten with a 6-state model (`idle` / `tracing` /
  `traced` / `stitching` / `error` / `done`) instead of 4, each with its
  own label *and* a small caption naming the actual backend call and
  tool doing the work (`POST /trace → potrace`, `POST /stitch →
  inkstitch`) — directly addresses "which function is used and which
  step."

Verified the full round trip through the real Vite dev proxy (not just
direct backend calls) — `POST /stitch/api/trace` then
`POST /stitch/api/stitch` — both `200`, size preserved correctly through
the trace step (`width="30.00mm"` in, `30.00mm` in the output DST).
`npx tsc -b` and `npm run build` both clean.

### Why we did it this way

Diagnosing from logs before touching any code mattered here — it would
have been easy to assume the earlier fix hadn't worked and start
"fixing" a problem that didn't exist. The actual bug was a UX gap, and
the two-step redesign both fixes that gap directly (real per-step
feedback) and gives the user a genuinely useful checkpoint: they can
now see the traced SVG and bail before running the slower stitch-
generation step on something that traced badly, rather than only
finding out after waiting for the whole pipeline.

Reused `Status` as a single source of truth for both the status label
and which button/panel is visible (`showPreview`, `showTraceButton` in
`App.tsx` derive from it) rather than tracking separate booleans, to
avoid the two ever disagreeing.

### Traps & problems encountered

- First draft overloaded the existing `"done"` status for both "step 1
  finished, review the preview" and "step 2 finished, download ready" —
  defeated the whole point of asking for clear step feedback. Added a
  distinct `"traced"` status instead of reusing `"done"` with a ternary.
- First draft also showed the old step-1 "Convert to SVG" button again
  after a step-2 (`/stitch`) failure, alongside `SvgPreview`'s own
  "Continue to DST" retry button — two different retry affordances on
  screen at once. Fixed: `showTraceButton` is now gated on
  `!showPreview`, so once a trace exists, `SvgPreview`'s own button is
  the only retry path, regardless of which step errored.

### Current state

Two-step flow live in `dev.sh`'s stack (backend rebuilt, frontend
rebuilt) and verified through the real dev proxy path. `backend/main.py`
now exposes `/trace`, `/stitch`, `/health`, and `/convert`
(convenience). Frontend: `SvgPreview.tsx` new, `StatusBar.tsx` and
`App.tsx` rewritten, `api.ts` replaced `convertFile()` with
`traceFile()` + `stitchSvg()`.

---

## Resolution normalization — the real fix for the complexity hang — 2026-09-23

### What we did

User correctly pushed back on the previous entry's "not really fixable
server-side, just timeout it" conclusion: real digitizing services
(Printful etc.) don't hang on photo uploads either, and asked
specifically about thresholding/downscaling resolution first, and
whether SVG input could go through the same PNG→SVG path. Tested the
idea properly instead of taking the pushback at face value or dismissing
it:

- Reproduced the hang generically with a synthetic noisy 2048px image
  traced at potrace's *default* settings (not file-specific).
- Proved resizing to 500px before tracing before tracing cuts traced
  complexity by >99% (15,534 → 62 coordinates) and fixes the timing
  (3s vs. 60s+ timeout).
- Extended it to SVG uploads too, via `cairosvg` rasterization — since
  an uploaded SVG can be just as overdetailed as a traced photo (this
  was, in fact, exactly what the user's original failing file was).
- While validating against a clean test logo (to make sure the fix
  doesn't degrade the good/intended case), caught a second, more subtle
  bug: potrace discards the original SVG's physical size entirely and
  always outputs pixel-count-based `pt` dimensions. Naively
  rasterizing+retracing turned a 50mm star into a ~212mm one, producing
  a DST 35x larger than it should be. Fixed by explicitly parsing and
  re-applying the intended physical size around the trace step.
- Implemented in `backend/main.py`: every upload (SVG or PNG) now goes
  through resize→potrace→(size-correction)→inkstitch, capped at
  `TRACE_MAX_DIMENSION = 600` px. Added `CairoSVG==2.9.1` to
  `requirements.txt`.
- Verified against a regenerated copy of the actual failure case (noisy
  2048px source, 80mm declared size) through the real `/convert`
  endpoint: 1.9s, 200 OK, 9,434 stitches, size preserved exactly at
  80.0mm × 80.0mm. Also re-verified the simple SVG and PNG smoke tests
  from earlier still pass.

### Why we did it this way

The previous session's conclusion (timeout + tell the user to manually
clean their art) was true as far as it went, but incomplete — it didn't
ask whether the server could just... not receive pathological input in
the first place, which is obviously how production services handle
this. Worth noting as a process lesson: the user's question ("how would
Printful handle this?") was a better diagnostic prompt than anything in
the original investigation, because it demanded explaining the
mechanism from first principles rather than accepting "this design is
just too detailed" as a terminal answer.

Rasterizing SVG uploads too (not just PNGs) was the right call given the
user's actual failing file was an already-traced SVG, not a PNG — a fix
that only touched the PNG path would have missed their exact case.

The physical-size bug was only caught because the fix was validated
against a *good* input (clean logo), not just the *bad* one that
prompted the investigation — testing only the failure case would have
shipped a fix that silently corrupted every normal SVG upload's real-
world size.

### Traps & problems encountered

- `cairosvg.svg2png` with only `output_width` set scales proportionally
  (verified with a 5:2 rect) — but only if you pass the *right* one of
  `output_width`/`output_height` for the design's own aspect ratio;
  always passing `output_width` would blow past the intended cap on a
  portrait-oriented design. Picked width vs. height based on the parsed
  physical size.
- potrace's `width="Npt"` output is silently wrong for any purpose that
  cares about real-world size — it's always 1:1 with the source raster's
  pixel dimensions, with no memory of an original SVG's declared units.
  Anything built on potrace needs to treat its output dimensions as
  meaningless and supply the real size itself.
- Regenerating the exact 2048px noisy test image inside a `docker exec`
  needed `-i` (interactive) for heredoc stdin piping — `docker exec …
  <<EOF` without `-i` silently ran nothing.

### Current state

`/convert` now normalizes every upload's resolution before tracing
regardless of format, and preserves the design's real physical size
through that normalization. HOTSPOT-005 and the new HOTSPOT-006 are both
marked resolved in `docs/HOTSPOTS.md`. `CONVERT_TIMEOUT_SECONDS` (90s)
remains as a defense-in-depth backstop, not the primary fix anymore.
Known open gap: plain PNG uploads still have no way to declare intended
physical embroidery size and fall back to a 100mm default — flagged in
HOTSPOT-006, not fixed here (frontend scope).

---

## "It takes forever" — complexity hang — debug + fix — 2026-09-23

### What we did

Right after the PNG-conversion fix, the user ran a real conversion
through `dev.sh` (a 229-path SVG, `IMG_0099.svg`) and asked whether it
was normal for it to take forever. Found the backend container pegged
at ~99% CPU for 2.5+ minutes with no sign of finishing — well past
README §8 C-004's 5-20s (Pi 5) estimate on a machine much faster than a
Pi. Root-caused it properly rather than guessing:

- Copied the real file out of the container before killing the stuck
  request, so it could be used for reproducible testing.
- Bisected via a throwaway container running the built `stitch-backend`
  image directly: merging all 229 paths into one didn't help; scaling
  the design to a realistic 100mm physical size didn't help; testing
  path-count subsets (5/20/50/100/150/229) all hung too — even 5 paths.
- That pointed at one specific dominant path. Isolated it: 106KB of the
  file's 159KB of path data, 145 subpaths (nested holes/detail). Still
  hung alone. Kept only its top-15/top-5/top-3/top-1 largest subpaths by
  data length — still hung, because the single largest subpath itself
  turned out to be the problem: 129 SVG command *letters* but 24,380
  numeric coordinates (SVG allows one `c` to chain thousands of implicit
  curve segments) — roughly 4,000 micro bezier curves in one contour.
- Installed real Inkscape in the test container just to run its
  `path-simplify` CLI action (`--actions="select-all;path-simplify;...
  ;export-do" --batch-process`) against the isolated path — 5 passes
  cut it from 24,380 to 494 coordinates, and conversion then completed
  in 31s. Re-ran the same simplify treatment across the *whole* 229-path
  file: still timed out at 90s — curve density and path count compound,
  simplifying one dimension isn't sufficient on its own.
- Added `CONVERT_TIMEOUT_SECONDS = 90` around the `inkstitch`/`potrace`
  subprocess calls in `backend/main.py`'s `_run()`: on
  `subprocess.TimeoutExpired`, `/convert` now returns `422` with an
  actionable message instead of hanging the single worker indefinitely.
  Rebuilt the image and confirmed a normal simple SVG still converts in
  well under a second post-change.

### Why we did it this way

Guessing at "SVG too complex, simplify it" would have been true but
useless without knowing *which* axis of complexity actually matters —
path count, physical size, node count, and curve-segment density are
all plausible culprits and behave very differently. Bisecting against
the real file in a disposable container (never touching the actual
repo/backend state) was the only way to get a concrete, falsifiable
answer, and it overturned two reasonable-looking hypotheses (path count,
physical size) before landing on the real one (implicit curve-segment
density in a single contour, compounding with subpath count).

A hard timeout was chosen over trying to auto-fix arbitrary uploaded
SVGs server-side: automatic "cleaning" (simplify + speckle removal) is
lossy and design-dependent judgment call that belongs with whoever's
choosing the source art, not something to silently apply to a
customer's upload. Failing fast with a clear reason lets the human
decide what to do next instead of staring at a spinner.

### Traps & problems encountered

- Inkscape 1.4's CLI action for this isn't `selection-simplify` (that
  action doesn't exist and fails silently per-action while the rest of
  the `--actions` chain continues) — the real name is `path-simplify`,
  found via `inkscape --action-list | grep -i simplif`.
- A naive "count SVG command letters" regex badly undersold this file's
  real complexity (129 letters looked trivial) because SVG path syntax
  lets one command letter be followed by many repeated implicit
  coordinate groups — counting numeric tokens instead is what actually
  revealed the ~4,000-curve reality.
- A synthetic "pathological" SVG built from random tiny curve deltas
  (meant to test the new timeout path) converted fine in 13s instead of
  hanging — random jitter isn't the same shape of complexity as real
  photo-trace detail, so the timeout branch itself was verified by code
  review (`subprocess.run(timeout=...)` is well-trodden stdlib
  behavior) rather than by directly observing a 422 fire. Worth
  reproducing for real if this becomes important later.

### Current state

`backend/main.py` now bounds every conversion to 90s and fails with a
clear, actionable `422` instead of hanging. This is a fail-fast
safeguard, not a fix for the underlying slowness — genuinely
photo-detailed source art is a bad fit for embroidery auto-fill
regardless of timeout handling; see `docs/HOTSPOTS.md` HOTSPOT-005 for
what the user should actually do differently with that specific design
(re-trace with a higher potrace `--turdsize`, or manually
clean/simplify in Inkscape before uploading).

---

## PNG conversion failure — debug + fix — 2026-09-23

### What we did

User reported: "I tried to convert a png and it failed." Root-caused and
fixed two independent bugs:

1. **HOTSPOT-001, confirmed for real.** `backend/Dockerfile`'s
   `inkstitch-v3.1.0-linux.zip` asset never existed on Ink/Stitch's
   GitHub releases — confirmed via the releases API. Real Linux
   distribution is a self-contained per-arch `tar.xz` bundle (own
   Python/wx/numpy, no system Inkscape needed). Rewrote the Dockerfile
   to download `inkstitch-<version>-linux-<aarch64|x86_64>.tar.xz`
   (arch picked from BuildKit's `TARGETARCH`), extract with `tar -xJf`
   to `/opt/inkstitch`, and put its `bin/` on `PATH`. Dropped the
   `inkscape` apt package entirely (not needed) in favor of the small
   set of GTK/wayland runtime libs the bundled wx toolkit actually
   needs (found by iterating `ImportError`s in a throwaway container:
   `libgtk-3-0`, `libwayland-cursor0`, `libwayland-egl1`,
   `libxkbcommon0`, `libsm6`, `libice6`, `libxtst6`, `libnotify4`,
   `libdrm2`, `libgl1`, `libegl1`).
2. **New: `potrace` can't read PNG.** Independent of the above —
   `potrace` only accepts pnm/pgm/pbm/bmp, never png, and
   `backend/main.py` was feeding it the raw upload. This is what
   actually broke the user's PNG upload once the Dockerfile was fixed.
   Fixed by converting to BMP with Pillow first
   (`backend/main.py`, `backend/requirements.txt` +Pillow==10.4.0).

Verified end-to-end by building the real image, running the real
container, and `curl`-ing `POST /convert` with both a synthetic SVG and
a synthetic PNG — both now return valid zips containing
`embroidery.dst` / `.pes` / `_threadlist.txt`.

Also rewrote `dev.sh`: it no longer runs the backend as a bare venv
process (which can only ever serve `/health` — no local machine here has
Inkscape/potrace/Ink/Stitch, and this was actively hiding the real bug
above). It now always builds/runs the backend as the real Docker image
and runs the frontend via `npm run dev` alongside it, with a
`--rebuild` flag to force a fresh image build.

### Why we did it this way

Chasing the exact missing-library errors one at a time in a throwaway
`python:3.11-slim` container (rather than guessing at a fixed apt
package list) was the fastest way to find the true minimal dependency
set — and confirmed system Inkscape isn't a dependency at all, contrary
to the original spec's assumption.

Pillow (already a near-universal dep) was chosen over shelling out to
ImageMagick for the PNG→BMP step to avoid adding another apt package for
one format conversion.

Switching `dev.sh` to Docker-only removes a whole class of "works for
me, fails in Docker/on the Pi" bugs — the venv path could never do a
real conversion locally anyway, so keeping it around only made future
`/convert` failures harder to diagnose.

### Traps & problems encountered

- `curl -sL` (silent + follow-redirects, no `-f`) downloaded a GitHub
  404 HTML page for the wrong asset name and happily called it
  `inkstitch.zip` — `unzip` then failed with a cryptic
  "End-of-central-directory signature not found" instead of a clear
  404. Dockerfile's `curl` now uses `-fsSL` so a bad URL fails the build
  immediately with a real HTTP error instead of downloading garbage.
- The bundled Ink/Stitch CLI imports `wx` even for the non-GUI
  `--extension=zip` path, so headless conversion still needs a real (if
  small) GTK/wayland runtime library set — it is not fully
  dependency-free just because there's no GUI involved.

### Current state

Backend Docker image builds and runs real conversions correctly for
both SVG and PNG uploads. `dev.sh` runs the real backend + frontend
together and was itself re-smoke-tested after the rewrite. HOTSPOT-001,
-003, and -004 marked resolved in `docs/HOTSPOTS.md`; HOTSPOT-002
(Discovery compose/Caddyfile merge) is the only one still open.

---

## Local dev runner — 2026-09-23

### What we did

Added `dev.sh` (repo root, executable): creates/reuses a backend venv,
installs `backend/requirements.txt`, warns if `inkscape`/`potrace`/
`inkstitch` aren't on PATH, then runs `uvicorn main:app --reload` on
:8001 and `npm run dev` on :5173 together, tearing both down on Ctrl-C.

### Why we did it this way

Docker isn't a realistic local dev loop here — the backend image only
builds meaningfully with Inkscape/Ink/Stitch present (arm64, Pi-target),
which this dev machine doesn't have (see HOTSPOT-001/003). A plain venv +
`npm run dev` combo gets fast iteration on the UI and the `/health`
endpoint without needing Docker at all; `/convert` will still fail here
until those system binaries are installed locally, which the script
warns about explicitly instead of failing silently.

### Traps & problems encountered

None — smoke-tested by running the script, confirming
`GET /health` → `{"status":"ok"}` and the Vite dev server returning
`200`, then killing both processes and confirming they stopped.

### Current state

`dev.sh` works end-to-end for local UI development. Full conversion
pipeline still untestable outside Docker/the Pi (HOTSPOT-003, unchanged).

---

## Initial scaffold — 2026-09-23

### What we did

- Added `.gitignore` (IDE files, OS cruft, Python/Node build artifacts,
  env files, stray conversion output).
- Implemented the backend exactly as specified in README.md §4:
  `backend/main.py` (`/health` + `/convert`, PNG→SVG via potrace,
  SVG→DST/PES/threadlist via `inkstitch`), `requirements.txt`,
  `Dockerfile` (Inkscape + Ink/Stitch + potrace on `python:3.11-slim`).
- Scaffolded the frontend per README.md §5: Vite + React 18 + TypeScript
  + Tailwind, with `App.tsx`, `api.ts`, and the four components
  (`DropZone`, `LiquidButton`, `StatusBar`, `ResultCard`) matching the
  described states/behavior, plus the SJEL design-token CSS block from
  §5.2 and the `tailwind.config.ts` from §5.3.
- Added root-level `docker-compose.yml` (the two services from §7.3,
  `sjel` network marked external) and `Caddyfile.snippet` (the `handle`
  blocks from §7.4), since this repo doesn't contain the Discovery
  compose file / Caddyfile those are meant to be merged into.
- Created `docs/HOTSPOTS.md` and this logbook per the standing
  memory-management workflow.

### Why we did it this way

The repo root here *is* what README §9's layout calls `stitch/` inside a
larger `sjel/` monorepo — so `backend/`, `frontend/`, `docs/` were placed
directly at repo root rather than nested under a duplicate `stitch/`
folder. Backend/frontend file contents follow the spec's literal code
blocks where given; anything not spelled out verbatim (App.tsx wiring,
package.json, tsconfig, vite/postcss config, index.html, ESLint,
vite-env.d.ts) was filled in to match the described component contracts
and layout diagram (§5.4).

`vite.config.ts` sets `base: "/"` rather than `"/stitch/"`: Caddy's
`uri strip_prefix /stitch` (§7.4) removes the prefix before the request
reaches the frontend container, so built asset paths must be root-
relative, not prefixed.

### Traps & problems encountered

- Tailwind's `@import` (Google Fonts) must precede the `@tailwind`
  directives in `index.css` or Vite's CSS processor errors on build —
  fixed by reordering.
- Caught the `base: "/stitch/"` vs `"/"` mismatch (see above) before it
  became a broken-asset-paths bug in production — would only have shown
  up once actually deployed behind Caddy.

### Current state

- Frontend: `npm install`, `npx tsc -b`, and `npm run build` all pass
  clean in this environment (Node v24.20.0 / npm 11.19.0). Not yet
  smoke-tested against a running backend (`npm run dev` + backend on
  :8001 untried here).
- Backend: Python syntax verified (`py_compile`); FastAPI/Ink/Stitch not
  installed in this environment, so `/convert` has not been executed.
  Needs a real Docker build (arm64 or emulated) to validate.
- Three items logged to `docs/HOTSPOTS.md` (Ink/Stitch release asset
  unverified, Discovery compose/Caddyfile not in this repo, no local way
  to smoke-test the conversion pipeline) — all waiting on dev input /
  real hardware, per the workflow's "stop and wait" rule for hotspots.
- README.md's roadmap (§10) Phase 1–2 code is written; Phase 1's
  Docker-build smoke test and Phase 3 (deploy) remain undone.

## Slow-conversion warning — 2026-09-25

### What we did

Added `SLOW_CONVERT_WARNING_SECONDS = 20` in `backend/main.py`. `_run()`
now times every `subprocess.run()` call and logs a `logger.warning(...)`
(module logger `"stitch"`) if a conversion finishes successfully but
took longer than 20s. `CONVERT_TIMEOUT_SECONDS` (90s, the hard backstop
that fails the request) is unchanged.

### Why we did it this way

User's instinct was that 90s is far too long before *anything* flags a
problem, and initially asked for a hard 5s timeout. Pushed back: README
§8 C-004 documents normal Pi 5 processing as 5-20s depending on stitch
count, and explicitly says "No timeout below 60s" — a 5s hard cutoff
would reject legitimate conversions, not just pathological ones (see
HOTSPOT-005/007 for why 90s was chosen as the real backstop).

User agreed a *warning* (logged, non-blocking) rather than a second hard
timeout was the right shape, and asked for the warning threshold itself
to land somewhere in the 5-20s documented-normal band rather than fixed
at 5s. Chose 20s specifically (the upper edge of that band): a
conversion that exceeds the documented normal case entirely is a real
signal something's off algorithmically, without false-alarming on
ordinary Pi-speed jobs that legitimately take up to 20s.

### Traps & problems encountered

None — small, additive change. No logging was configured anywhere in
`main.py` before this; added `import logging` + a module-level
`logger = logging.getLogger("stitch")`. Python's logging "last resort"
handler means `logger.warning(...)` prints to stderr even with zero
explicit config, so this is visible in `docker logs` out of the box —
but worth revisiting if/when real log aggregation is set up for the Pi
deployment.

### Current state

- `backend/main.py` syntax-checked (`ast.parse`), not yet exercised
  against a real Docker build/conversion — the warning path (>20s) is
  also hard to trigger deliberately without a slow-enough test file.
- `docs/PROGRESS.md` not yet updated to reflect this change.
