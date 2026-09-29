# HOTSPOTS

## [HOTSPOT-007] Dense continuous noise can still exceed the 90s timeout at default threshold

- **Severity**: 🟢 noted
- **Status**: resolved (existing timeout catches it; no new hang risk)

While validating the new threshold slider (potrace `-k`/blacklevel,
`backend/main.py` `THRESHOLD_MIN/MAX`), found that `TRACE_MAX_DIMENSION`
(HOTSPOT-006) does not unconditionally bound complexity for every noise
pattern: a synthetic 600px image with *continuous* per-pixel grayscale
noise (not just sparse speckle, which HOTSPOT-006 tested) produced
100K-170K traced curve-coordinates at blacklevel values from 0.2-0.8 —
including 0.5, potrace's own default. Confirmed via a clean, isolated
container test that `POST /stitch` on this exact file correctly returns
`422` at **90.04s** (`CONVERT_TIMEOUT_SECONDS`) — the existing timeout
backstop from HOTSPOT-005 catches this case properly. `THRESHOLD_MIN/MAX`
(0.2-0.65) bound the slider to sane-*looking* values, not complexity —
the 90s timeout is what actually guarantees no hang, at any slider
position.

**Investigation trap worth recording**: an early test of this same file
appeared to hang for **17+ minutes** before returning, which looked like
a critical failure of the `CONVERT_TIMEOUT_SECONDS` mechanism itself.
Root-caused via a from-scratch isolated `subprocess.run(timeout=15)`
test (worked correctly, 15.03s) and a clean container retest of the
real endpoint (worked correctly, 90.04s) — the 17-minute reading was an
artifact of running a competing CPU-bound `docker exec` process against
the *same* long-lived container while also hitting it over HTTP,
starving both of CPU on a resource-constrained dev machine. Do not trust
a single alarming timing result without isolating the variable (fresh
container, nothing else running) before concluding a fix is broken.

**Known real limitation, not fixed here**: the backend handles requests
with blocking `subprocess.run()` calls directly inside `async def`
route handlers, on a single uvicorn worker. This means concurrent
requests (two users converting at once, or a retry sent while the first
attempt is still processing) queue and block each other rather than
running in parallel — each can still take up to `CONVERT_TIMEOUT_SECONDS`
on its own. Not a bug in the sense of anything hanging *forever*, but a
real scalability ceiling worth knowing about before this is used by more
than one person at a time. Fixing it properly (a thread pool executor,
or multiple uvicorn workers) is a bigger architectural change than this
fix's scope.


## [HOTSPOT-001] Ink/Stitch arm64 release asset unverified

- **Severity**: 🟢 noted (was 🟡 watch)
- **Status**: resolved

Was unverified; now verified against the real GitHub API. The asset name
`inkstitch-v3.1.0-linux.zip` in the original spec **never existed** —
Ink/Stitch's Linux release is a self-contained tar.xz bundle per
architecture (`inkstitch-<version>-linux-aarch64.tar.xz` /
`-x86_64.tar.xz`), not an Inkscape-extension zip. It bundles its own
Python/wx/numpy — no system `inkscape` package is needed at all, just a
handful of GTK/wayland runtime libs. `backend/Dockerfile` was rewritten
to download the correct per-arch asset (via `TARGETARCH`), extract with
`tar -xJf`, and add `/opt/inkstitch/bin` to `PATH`. Verified with a real
`docker build` + a live SVG→DST conversion producing a valid
`.dst`/`.pes`/threadlist zip. Still worth re-checking on a real version
bump (`INKSTITCH_VERSION` build-arg) since asset naming has changed
across major versions before.

## [HOTSPOT-002] Discovery compose file / Caddyfile not in this repo

- **Severity**: 🟢 noted
- **Status**: waiting for dev (unchanged)

Still applies — `docker-compose.yml` and `Caddyfile.snippet` at repo
root need to be merged into the real Discovery-side files by hand at
deploy time.

## [HOTSPOT-003] No real Ink/Stitch/Inkscape available to smoke-test

- **Severity**: 🟢 noted (was 🟡 watch)
- **Status**: resolved

Resolved via Docker: built `backend/Dockerfile` for real and ran actual
conversions (SVG and PNG, both end-to-end through `POST /convert`)
against the container. Native macOS Inkscape/potrace/Ink/Stitch still
aren't installed on this dev machine (no Homebrew here) — `dev.sh` no
longer tries to run the backend as a bare venv process for this reason;
it now always runs the backend via Docker (see LOGBOOK 2026-09-23).

## [HOTSPOT-004] `potrace` cannot read PNG input directly

- **Severity**: 🟢 noted (was blocking a real user-reported failure)
- **Status**: resolved

`backend/main.py` §4.1 originally passed the uploaded PNG straight to
`potrace --svg -o ...`. potrace only reads pnm/pgm/pbm/bmp — never png —
and fails immediately with `file format not recognized`. This was the
actual bug behind the user's "I tried to convert a png and it failed"
report (on top of, and independent from, HOTSPOT-001/003). Fixed by
converting the upload to BMP with Pillow before handing it to potrace.
`Pillow==10.4.0` added to `backend/requirements.txt`. Verified: a real
PNG upload through the Dockerized backend now returns a valid
DST/PES/threadlist zip.

## [HOTSPOT-005] Highly detailed designs can hang `/convert` indefinitely

- **Severity**: 🟢 noted (was 🟡 watch)
- **Status**: resolved — see HOTSPOT-006 for the actual fix

A real user upload (a 229-path, potrace-traced photo SVG) ran the
backend at ~99% CPU for 2.5+ minutes with no sign of finishing — far
past README §8 C-004's 5-20s (Pi 5) expectation, on a much faster dev
machine. Root-caused by bisecting the file in a throwaway container:

- Not path *count* (229 elements barely matters on their own).
- Not physical size (rescaling to a realistic 100mm didn't help).
- The real driver: one dominant `<path>` had 129 SVG command *letters*
  but **24,380 numeric coordinates** — SVG lets one `c` chain thousands
  of implicit curve segments, so that single contour was actually
  ~4,000 micro bezier curves (photographic noise-level detail, not a
  clean outline). Isolating just that one path still hung at 40s.
- Running Inkscape's `path-simplify` action on it (5 passes,
  `inkscape file.svg --actions="select-all;path-simplify;...;export-do"
  --batch-process`) cut it to 494 coordinates and it converted in 31s.
  But re-running simplify across the *whole* 229-path file and
  converting still timed out at 90s — the many small separate paths
  compound with curve density; simplifying one alone isn't a full fix.

This is a real characteristic of Ink/Stitch's auto-fill/routing
algorithm on fine-detail/photo-traced art, not a bug in this repo's
code — but the backend had zero protection against it. Added a
90-second timeout around the `inkstitch`/`potrace` subprocess calls in
`backend/main.py` (`CONVERT_TIMEOUT_SECONDS`): on expiry, `/convert`
now returns `422` with an actionable message instead of hanging the
worker forever. Verified normal/simple SVGs still convert in under a
second post-fix.

Originally written up as "not really fixable server-side" — wrong; see
HOTSPOT-006, which fixes the actual root cause automatically for every
upload rather than requiring the user to manually clean source art.
`CONVERT_TIMEOUT_SECONDS` stays in place as a defense-in-depth backstop
regardless.

## [HOTSPOT-006] Root fix for HOTSPOT-005: normalize resolution before tracing

- **Severity**: 🟢 noted
- **Status**: resolved

User pushed back on HOTSPOT-005's original "not really fixable
server-side" conclusion, correctly: real digitizing services (Printful
etc.) don't hang on photos either, and asked specifically whether
thresholding/downscaling resolution first would work. Tested it
properly rather than assuming:

- Built a synthetic noisy 2048px "photo" (solid blob + per-pixel noise,
  same shape of problem as the real upload) and traced it with
  *default* potrace settings — reproduced the hang (60s+, no output).
  Confirms this is a general property of noisy source images with
  default settings, not something unique to one file.
- Resizing that source to 500px before tracing (Pillow `LANCZOS`)
  collapsed traced complexity from 15,534 numeric coordinates to 62 — a
  >99% reduction, since sub-pixel noise just gets averaged away by the
  resample. Converted in 3s (vs. 60s+ timeout at full resolution).
- Extended the same idea to SVG uploads (not just PNG): rasterize any
  uploaded SVG to a bounded resolution via `cairosvg` first, then run it
  through the same resize→potrace pipeline. Verified on a regenerated
  copy of the real failure case (noisy 2048px source, declared 80mm
  physical size): **1.9s, 200 OK, 9434 stitches, size preserved exactly
  at 80.0mm × 80.0mm** — down from hanging indefinitely.
- Caught a serious footgun while validating against a *clean* test
  logo: potrace always emits pixel-count-based `width="Npt"` on its
  output, discarding whatever physical size (e.g. `50mm`) the original
  upload declared. Naively rasterizing+retracing a clean 50mm star
  produced a DST **35x larger** than direct conversion, because the
  round-trip silently turned it into a ~212mm design. Fixed by parsing
  the original SVG's declared width/height (or falling back to
  `DEFAULT_DESIGN_MM` for plain PNGs, which never carry real-world size
  at all) *before* rasterizing, and rewriting potrace's output
  dimensions to match afterward. Re-verified: the same clean logo now
  round-trips to within ~2x of the direct-conversion DST size (minor,
  expected cost from resample-edge aliasing), not 35x.

Implemented in `backend/main.py`: `TRACE_MAX_DIMENSION = 600` (bounds
every upload, SVG or PNG, to 600px on its longest side before potrace),
`_svg_physical_size_mm()` (parses declared width/height in mm/cm/in/pt/
px), and a post-trace regex rewrite of potrace's `pt` dimensions to the
real target size. `CairoSVG==2.9.1` added to `requirements.txt`; no
Dockerfile change needed (`libcairo2` was already present transitively
via the GTK stack pulled in for the bundled Ink/Stitch CLI — verified by
`pip install cairosvg` importing cleanly with no new apt packages).

**Known remaining gap**: a plain PNG upload has no way to declare its
intended physical embroidery size (potrace/our own pipeline has no
concept of "this photo should become a 10cm patch" vs. a 5cm one) — it
silently falls back to `DEFAULT_DESIGN_MM` (100mm square). Real
digitizing services ask the customer for garment/hoop size up front.
Worth adding a size field to the frontend upload form rather than
guessing; out of scope for this fix.
