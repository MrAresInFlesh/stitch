from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import cairosvg
import subprocess, tempfile, shutil, pathlib, re, time, logging

logger = logging.getLogger("stitch")

app = FastAPI(title="SJEL Stitch API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tightened in prod via Caddy headers
    allow_methods=["POST"],
    allow_headers=["*"],
)

ALLOWED_TYPES = {"image/svg+xml", "image/png"}
MAX_SIZE_MB   = 20

# Ink/Stitch's auto-fill/routing can blow up on highly detailed designs
# (e.g. a photo-traced SVG with thousands of micro-curve segments in a
# single path) — a real case, not a hypothetical: see docs/HOTSPOTS.md
# HOTSPOT-005. Without a bound, one such upload ties up the worker
# indefinitely with no feedback. README §8 C-004 expects 5-20s normal
# case on a Pi 5; this gives real designs generous headroom while still
# failing fast (with an actionable message) on pathological ones.
CONVERT_TIMEOUT_SECONDS = 90

# README §8 C-004's own documented normal case is 5-20s on a Pi 5. A
# conversion that finishes successfully but lands outside that window
# isn't a hang (CONVERT_TIMEOUT_SECONDS above still catches those) — it's
# a signal the auto-fill algorithm is struggling on this particular
# design and is worth a developer's eyes. Logged, not rejected: unlike
# the hard timeout, this never fails the request.
SLOW_CONVERT_WARNING_SECONDS = 20

# Every upload is normalized through a raster pass, capped to this many
# pixels on its longest side, before potrace ever sees it — see
# docs/HOTSPOTS.md HOTSPOT-006 for why (verified empirically: a
# synthetic noisy 2048px source collapsed from 15,534 traced
# curve-coordinates to 62 at 500px, and converted in 3s instead of
# hanging past 60s).
TRACE_MAX_DIMENSION = 600

# Fallback physical design size (mm, square) when it can't be determined
# from the upload — a plain PNG carries no real-world size at all, and
# an SVG without a usable width/height falls back to this too.
DEFAULT_DESIGN_MM = 100.0

# potrace's black/white cutoff (-k/--blacklevel, default 0.5, valid
# range 0-1). Exposed to the frontend as a "threshold" slider. Capped
# well below 1.0 on purpose: a higher cutoff classifies more of the
# image as black/traced detail, which is exactly the axis that caused
# the HOTSPOT-005/006 complexity hang — TRACE_MAX_DIMENSION bounds
# *resolution*, but a dense-noise source (continuous grayscale texture,
# not just sparse speckle) can still blow past 100K traced curve-
# coordinates at ANY blacklevel from 0.2-0.8, even at the 600px cap (see
# docs/HOTSPOTS.md HOTSPOT-007). CONVERT_TIMEOUT_SECONDS is what
# actually catches that case — verified for real: a k=0.5 trace of a
# dense-noise 600px image correctly timed out with a clean 422 at 90.04s
# in an isolated container. THRESHOLD_MIN/MAX bound the slider's UI
# range for sane results, not complexity — the 90s timeout is the real
# backstop regardless of where the slider sits.
THRESHOLD_MIN = 0.2
THRESHOLD_MAX = 0.65
THRESHOLD_DEFAULT = 0.5

_UNIT_TO_MM = {"mm": 1.0, "cm": 10.0, "in": 25.4, "pt": 25.4 / 72, "px": 25.4 / 96}


@app.get("/health")
def health():
    return {"status": "ok"}


# --- Step 1: PNG or SVG -> normalized, complexity-bounded, correctly-
# sized SVG. Split out from stitch generation (step 2 below) so the
# frontend can show the traced result and let the user confirm before
# running the slower auto-fill/routing step (see docs/LOGBOOK.md,
# 2026-09-23 "two-step workflow" entry for why).
@app.post("/trace")
async def trace(file: UploadFile = File(...), threshold: float = Form(THRESHOLD_DEFAULT)):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(415, "Only SVG and PNG accepted")
    threshold = max(THRESHOLD_MIN, min(THRESHOLD_MAX, threshold))

    with tempfile.TemporaryDirectory() as tmp:
        raw = await file.read()
        svg_path = _trace_to_svg(file.content_type, raw, tmp, threshold)
        svg_text = svg_path.read_text()

    return Response(content=svg_text, media_type="image/svg+xml")


# --- Step 2: a traced SVG (as returned by /trace) -> DST/PES/threadlist
# zip. Deliberately only accepts SVG — it assumes /trace already ran, so
# it never re-normalizes or re-checks physical size.
@app.post("/stitch")
async def stitch(file: UploadFile = File(...)):
    if file.content_type != "image/svg+xml":
        raise HTTPException(415, "Expected the traced SVG produced by /trace")

    with tempfile.TemporaryDirectory() as tmp:
        svg_path = pathlib.Path(tmp) / "design.svg"
        svg_path.write_bytes(await file.read())
        out = _stitch_to_zip(svg_path, tmp)

    stem = pathlib.Path(file.filename).stem or "design"
    return FileResponse(
        out,
        media_type="application/zip",
        filename=f"{stem}_embroidery.zip",
        background=_cleanup(out),
    )


# --- Convenience: trace + stitch in one call, for direct API use (the
# frontend uses /trace then /stitch separately so it can show a preview
# in between).
@app.post("/convert")
async def convert(file: UploadFile = File(...), threshold: float = Form(THRESHOLD_DEFAULT)):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(415, "Only SVG and PNG accepted")
    threshold = max(THRESHOLD_MIN, min(THRESHOLD_MAX, threshold))

    with tempfile.TemporaryDirectory() as tmp:
        raw = await file.read()
        svg_path = _trace_to_svg(file.content_type, raw, tmp, threshold)
        out = _stitch_to_zip(svg_path, tmp)

    stem = pathlib.Path(file.filename).stem
    return FileResponse(
        out,
        media_type="application/zip",
        filename=f"{stem}_embroidery.zip",
        background=_cleanup(out),
    )


def _trace_to_svg(content_type: str, raw: bytes, tmp: str, threshold: float = THRESHOLD_DEFAULT) -> pathlib.Path:
    """PNG or SVG bytes -> a normalized, complexity-bounded SVG file in
    `tmp`, with its physical size preserved/corrected. See
    docs/HOTSPOTS.md HOTSPOT-005/006."""
    # Figure out the design's intended real-world size BEFORE any
    # resampling below — potrace always emits pixel-count-based "pt"
    # dimensions on its output regardless of input, so if we don't carry
    # the original physical size through explicitly, resizing for
    # complexity's sake would silently also resize the finished
    # embroidery.
    width_mm = height_mm = DEFAULT_DESIGN_MM
    if content_type == "image/svg+xml":
        parsed = _svg_physical_size_mm(raw)
        if parsed:
            width_mm, height_mm = parsed

    # Normalize to a bounded raster resolution before tracing. SVGs get
    # rasterized here too, not just PNGs — an uploaded SVG can be just
    # as (or more) detailed as a traced photo.
    png_path = pathlib.Path(tmp) / "normalized.png"
    if content_type == "image/svg+xml":
        if width_mm >= height_mm:
            cairosvg.svg2png(bytestring=raw, write_to=str(png_path),
                              output_width=TRACE_MAX_DIMENSION)
        else:
            cairosvg.svg2png(bytestring=raw, write_to=str(png_path),
                              output_height=TRACE_MAX_DIMENSION)
    else:
        src_png = pathlib.Path(tmp) / "upload.png"
        src_png.write_bytes(raw)
        img = Image.open(src_png)
        img.thumbnail((TRACE_MAX_DIMENSION, TRACE_MAX_DIMENSION), Image.LANCZOS)
        img.save(png_path)

    # potrace only reads pnm/pgm/pbm/bmp, never png directly (see
    # docs/HOTSPOTS.md HOTSPOT-004).
    bmp_path = pathlib.Path(tmp) / "normalized.bmp"
    Image.open(png_path).convert("L").save(bmp_path)

    svg_path = pathlib.Path(tmp) / "traced.svg"
    _run(["potrace", "--svg", "-k", f"{threshold:.2f}", "-o", str(svg_path), str(bmp_path)])

    # Overwrite potrace's pixel-count "pt" dimensions with the real
    # target size determined above.
    traced = svg_path.read_text()
    traced = re.sub(r'width="[\d.]+pt"', f'width="{width_mm:.2f}mm"', traced, count=1)
    traced = re.sub(r'height="[\d.]+pt"', f'height="{height_mm:.2f}mm"', traced, count=1)
    svg_path.write_text(traced)

    return svg_path


def _stitch_to_zip(svg_path: pathlib.Path, tmp: str) -> pathlib.Path:
    """Traced SVG -> DST/PES/threadlist zip, copied out to /tmp (the
    caller's tempdir is gone by the time FileResponse streams it)."""
    zip_path = svg_path.with_suffix(".zip")
    _run([
        "inkstitch",
        "--extension=zip",
        "--format-dst=True",
        "--format-pes=True",
        "--format-threadlist=True",
        str(svg_path),
    ], stdout=zip_path)

    out = pathlib.Path("/tmp") / zip_path.name
    shutil.copy(zip_path, out)
    return out


def _svg_physical_size_mm(svg_bytes: bytes) -> tuple[float, float] | None:
    """Best-effort parse of an SVG's declared width/height into mm.
    Returns None if absent, unparseable, or in unsupported units (e.g. %)."""
    text = svg_bytes.decode("utf-8", errors="ignore")
    w = re.search(r'width="\s*([\d.]+)\s*(mm|cm|in|pt|px)?\s*"', text)
    h = re.search(r'height="\s*([\d.]+)\s*(mm|cm|in|pt|px)?\s*"', text)
    if not (w and h):
        return None
    try:
        w_unit = _UNIT_TO_MM.get(w.group(2) or "px", _UNIT_TO_MM["px"])
        h_unit = _UNIT_TO_MM.get(h.group(2) or "px", _UNIT_TO_MM["px"])
        width_mm = float(w.group(1)) * w_unit
        height_mm = float(h.group(1)) * h_unit
        if width_mm <= 0 or height_mm <= 0:
            return None
        return width_mm, height_mm
    except ValueError:
        return None


def _run(cmd: list[str], stdout=None):
    kwargs = {}
    if stdout:
        kwargs["stdout"] = open(stdout, "wb")
    start = time.monotonic()
    try:
        result = subprocess.run(
            cmd, capture_output=not stdout, timeout=CONVERT_TIMEOUT_SECONDS, **kwargs
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(
            422,
            f"Conversion did not finish within {CONVERT_TIMEOUT_SECONDS}s — this "
            "design is too detailed for auto-fill stitch generation even after "
            "resolution normalization. Simplify the artwork further and try "
            "again.",
        )
    elapsed = time.monotonic() - start
    if elapsed > SLOW_CONVERT_WARNING_SECONDS:
        logger.warning(
            "slow conversion: %s took %.1fs (normal range is %ss, hard "
            "timeout is %ss) — cmd: %s",
            cmd[0], elapsed, "5-20", CONVERT_TIMEOUT_SECONDS, cmd,
        )
    if result.returncode != 0:
        raise HTTPException(500, f"Conversion failed: {result.stderr.decode()}")


def _cleanup(path):
    from starlette.background import BackgroundTask
    return BackgroundTask(lambda: path.unlink(missing_ok=True))
