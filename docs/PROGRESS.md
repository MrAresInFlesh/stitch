# PROGRESS

Snapshot of where SJEL Stitch actually stands. Unlike `LOGBOOK.md`
(chronological diary of how it got here) this is a point-in-time
summary — update it when the state changes meaningfully, don't append
to it.

**Last updated**: 2026-09-25

---

## What's built

**Backend** (`backend/main.py`, FastAPI):
- `GET /health`
- `POST /trace` — PNG or SVG upload → normalized, complexity-bounded,
  correctly-sized traced SVG. Accepts a `threshold` field (potrace
  `-k`/blacklevel, 0.2–0.65, server-clamped).
- `POST /stitch` — a traced SVG (as `/trace` returns) → DST/PES/
  threadlist zip.
- `POST /convert` — thin convenience wrapper of both, for direct API
  use; the frontend doesn't call this.
- Conversions are timed: still a hard 90s timeout (`CONVERT_TIMEOUT_SECONDS`,
  unchanged, returns `422`), plus a new non-blocking `logger.warning` if
  a conversion succeeds but takes longer than 20s
  (`SLOW_CONVERT_WARNING_SECONDS`) — README §8 C-004's documented normal
  case is 5-20s on Pi 5, so this flags anything past that band without
  rejecting real jobs.

**Frontend** (`frontend/`, React + Vite + TS + Tailwind):
- Two-step flow: upload → threshold slider → **Convert to SVG** →
  live preview of the traced result → **Continue to DST** → download.
- Per-step status feedback (`StatusBar.tsx`) naming the actual backend
  call and tool running (`POST /trace → potrace`, `POST /stitch →
  inkstitch`), not a generic spinner.
- SVG preview is downloadable independent of continuing to DST
  (`SvgPreview.tsx`).
- SJEL design tokens/components matching Discovery's visual system per
  README §5.

**Dev tooling**:
- `dev.sh` — builds/runs the real backend Docker image (Inkscape-free
  Ink/Stitch CLI bundle + potrace) on :8001, Vite dev server on :5173,
  `--rebuild` flag to force a fresh image.
- `docker-compose.yml` + `Caddyfile.snippet` at repo root, for merging
  into the real Discovery deployment (not usable standalone — see
  HOTSPOT-002).

---

## Verified (not just written — actually run and checked)

- Real `docker build` of the backend image succeeds; Ink/Stitch's
  actual Linux release (self-contained tar.xz, not the nonexistent zip
  the original spec named) installs and runs.
- SVG and PNG uploads both convert end-to-end to valid DST/PES/
  threadlist, through the real HTTP endpoints (not just unit-level).
- Physical size (mm) is preserved correctly through the trace step,
  including through resolution normalization and the threshold slider.
- The resolution-normalization fix (`TRACE_MAX_DIMENSION=600`)
  collapses a previously-hanging complex/photo-traced upload to a
  1-2s conversion.
- The 90s timeout backstop (`CONVERT_TIMEOUT_SECONDS`) genuinely fires
  and returns a clean `422` on a real pathological input, verified in
  an isolated container (90.04s).
- Threshold slider genuinely changes potrace's output (not a no-op)
  and server-side clamping rejects out-of-range client values.
- Frontend typechecks and builds clean (`npx tsc -b`, `npm run build`).

## Not yet verified

- Real deployment on Raspberry Pi 5 hardware (arm64) — only tested via
  local Docker build on this dev machine (also arm64, Apple Silicon, so
  the *architecture* matches, but the actual Pi has not run this).
- Behavior under concurrent requests (see HOTSPOT-007 — single blocking
  worker, requests queue rather than run in parallel; not tested under
  real concurrent load).
- No automated test suite exists — everything above was verified via
  manual `docker build` + `curl` sessions during development, not
  regression-tested.

---

## Known limitations (see `docs/HOTSPOTS.md` for full detail)

| ID | Summary |
|---|---|
| HOTSPOT-002 | `docker-compose.yml`/`Caddyfile.snippet` need manual merge into Discovery's real deploy files — not usable standalone |
| HOTSPOT-006 | Plain PNG uploads have no way to declare intended physical embroidery size — falls back to a 100mm default |
| HOTSPOT-007 | Single-worker blocking backend — concurrent requests queue rather than run in parallel |

All other numbered hotspots (001, 003, 004, 005) are resolved.

---

## How to run it

```
./dev.sh            # backend (Docker) on :8001, frontend (Vite) on :5173
./dev.sh --rebuild   # force a fresh backend image build
```

Requires Docker (for the real Ink/Stitch CLI + potrace) and Node/npm.
No native Inkscape/Ink/Stitch install needed on the host.

---

## Suggested next steps (not started)

- Deploy to the actual Pi and merge the compose/Caddy files into
  Discovery's real deployment (HOTSPOT-002).
- Add a physical-size input to the frontend for PNG uploads
  (HOTSPOT-006) rather than silently defaulting to 100mm.
- Decide whether the concurrent-request queueing limitation
  (HOTSPOT-007) matters for real usage, and if so, move blocking
  subprocess calls off the event loop (thread pool executor or
  multiple uvicorn workers).
