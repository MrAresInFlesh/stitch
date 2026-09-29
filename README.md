# STITCH — Embroidery File Converter

## Development Specification — 2026-09-23

Internal tooling: SVG / PNG → DST (+ PES, thread list) web app.
Deployed on the Raspberry Pi alongside SJEL Discovery. Converts design files
into machine-ready embroidery formats using Ink/Stitch headlessly — no
external digitizing service, no per-file fee, no locked-in DST files.

---

## 1. Goals

- Accept a clean **SVG** (or PNG fallback) and return a **DST zip** ready to
  hand to any Alibaba manufacturer.
- Match **SJEL Discovery's visual system** exactly — same tokens, same fonts,
  same component patterns (see §5 UI spec).
- Run fully **offline on the Pi**, behind Caddy, no external API calls at
  runtime.
- Be **simple to maintain**: one backend file, one page of frontend, one
  docker-compose entry alongside Discovery.

---

## 2. Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | Same toolchain as Discovery |
| Styling | Tailwind CSS | Shares the same token approach; own config |
| Backend | FastAPI (Python 3.11) | Thin — one endpoint does the work |
| Conversion | Inkscape + Ink/Stitch (CLI) | Installed in the backend container |
| Vectoriser | Potrace | PNG → SVG pre-step (only when PNG is uploaded) |
| Container | Docker + docker-compose | Single compose file, two services |
| Reverse proxy | Caddy | Already running — add one more `reverse_proxy` block |
| Target host | Raspberry Pi 5 (arm64) | All base images must have arm64 variants |

---

## 3. Architecture

```
Browser
  │
  ▼
Caddy (:443)
  ├── /stitch/*      → frontend container (:4173)   [Vite preview / nginx]
  └── /stitch/api/*  → backend container (:8001)    [FastAPI + uvicorn]
                              │
                        subprocess call
                              │
                     inkscape --extension=zip
                       (Ink/Stitch headless)
                              │
                       returns .zip (DST + PES + thread list)
```

The backend never stores files on disk beyond the duration of a single
request. Input and output live in `tempfile.TemporaryDirectory` contexts that
auto-clean on exit.

---

## 4. Backend

### 4.1 File: `backend/main.py`

```python
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import subprocess, tempfile, shutil, os, pathlib

app = FastAPI(title="SJEL Stitch API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tightened in prod via Caddy headers
    allow_methods=["POST"],
    allow_headers=["*"],
)

ALLOWED_TYPES = {"image/svg+xml", "image/png"}
MAX_SIZE_MB   = 20

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/convert")
async def convert(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(415, "Only SVG and PNG accepted")

    with tempfile.TemporaryDirectory() as tmp:
        src = pathlib.Path(tmp) / file.filename
        src.write_bytes(await file.read())

        if file.content_type == "image/png":
            svg_path = src.with_suffix(".svg")
            _run(["potrace", "--svg", "-o", str(svg_path), str(src)])
            src = svg_path

        zip_path = src.with_suffix(".zip")
        _run([
            "inkstitch",
            "--extension=zip",
            "--format-dst=True",
            "--format-pes=True",
            "--format-threadlist=True",
            str(src),
        ], stdout=zip_path)

        # copy out before tempdir is deleted
        out = pathlib.Path("/tmp") / zip_path.name
        shutil.copy(zip_path, out)

    stem = pathlib.Path(file.filename).stem
    return FileResponse(
        out,
        media_type="application/zip",
        filename=f"{stem}_embroidery.zip",
        background=_cleanup(out),
    )

def _run(cmd: list[str], stdout=None):
    kwargs = {}
    if stdout:
        kwargs["stdout"] = open(stdout, "wb")
    result = subprocess.run(cmd, capture_output=not stdout, **kwargs)
    if result.returncode != 0:
        raise HTTPException(500, f"Conversion failed: {result.stderr.decode()}")

def _cleanup(path):
    from starlette.background import BackgroundTask
    return BackgroundTask(lambda: path.unlink(missing_ok=True))
```

### 4.2 `backend/requirements.txt`

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
python-multipart==0.0.9
```

### 4.3 `backend/Dockerfile`

```dockerfile
FROM python:3.11-slim

# System packages: inkscape (with Ink/Stitch), potrace
RUN apt-get update && apt-get install -y --no-install-recommends \
        inkscape \
        potrace \
        curl \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Ink/Stitch extension for the installed Inkscape
# Adjust the release URL to the latest arm64 release from:
# https://github.com/inkstitch/inkstitch/releases
ARG INKSTITCH_VERSION=3.1.0
RUN curl -sL \
    "https://github.com/inkstitch/inkstitch/releases/download/v${INKSTITCH_VERSION}/inkstitch-v${INKSTITCH_VERSION}-linux.zip" \
    -o /tmp/inkstitch.zip \
    && unzip /tmp/inkstitch.zip -d /usr/share/inkscape/extensions/inkstitch \
    && rm /tmp/inkstitch.zip

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
```

> **Note:** Ink/Stitch packages the `inkstitch` CLI binary inside its release
> zip. Verify the exact binary name and path after installing on the Pi with
> `find /usr/share/inkscape/extensions -name "inkstitch*"`. The path may need
> to be added to `$PATH` or called with its full path.

---

## 5. Frontend

### 5.1 Structure

```
frontend/
  src/
    App.tsx          — single page (no router needed)
    components/
      DropZone.tsx   — drag-and-drop upload area
      StatusBar.tsx  — idle / uploading / done / error states
      ResultCard.tsx — download block shown on success
    styles/
      index.css      — SJEL tokens + Bebas Neue / Barlow / Space Mono import
    api.ts           — fetch wrapper for POST /api/convert
  tailwind.config.ts
  vite.config.ts
  Dockerfile
```

### 5.2 Design tokens (`frontend/src/styles/index.css`)

Mirror the Discovery token set verbatim — copy the `:root` block from
Discovery's `index.css` unchanged. This keeps the two apps visually
identical without a shared package.

```css
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@300;400;600&family=Space+Mono:wght@400;700');

:root {
  --color-bg-base:      0   0   0;
  --color-bg-surface:   10  10  10;
  --color-bg-elevated:  20  20  20;
  --color-border:       56  56  56;
  --color-border-subtle:86  86  86;
  --color-text-primary: 255 255 255;
  --color-text-secondary:214 214 214;
  --color-text-muted:   176 176 176;
  --color-text-faint:   128 128 128;
  --color-accent:       245 245 245;
  --color-accent-dim:   140 140 140;
  --color-accent-bright:255 255 255;
  --color-gold:         196 168 106;   /* limited use only */
}

* { border-radius: 0 !important; }
* { box-sizing: border-box; }

body {
  background-color: rgb(var(--color-bg-base));
  color: rgb(var(--color-text-primary));
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 18px;
}

h1, h2, h3, h4, h5, h6 { font-family: 'Bebas Neue', sans-serif; }
code, pre, .font-mono    { font-family: 'Space Mono', monospace; }
```

### 5.3 `tailwind.config.ts`

```typescript
const v = (name: string) => `rgb(var(--color-${name}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "bg-base":        v("bg-base"),
        "bg-surface":     v("bg-surface"),
        "bg-elevated":    v("bg-elevated"),
        border:           v("border"),
        "border-subtle":  v("border-subtle"),
        "text-primary":   v("text-primary"),
        "text-secondary": v("text-secondary"),
        "text-muted":     v("text-muted"),
        "text-faint":     v("text-faint"),
        accent:           v("accent"),
        "accent-dim":     v("accent-dim"),
        "accent-bright":  v("accent-bright"),
        gold:             v("gold"),
      },
      fontFamily: {
        display: ['"Bebas Neue"', "sans-serif"],
        body:    ['"Barlow Condensed"', "sans-serif"],
        mono:    ['"Space Mono"', "monospace"],
      },
      borderRadius: {
        DEFAULT: "0",
        sm: "0", md: "0", lg: "0", xl: "0", "2xl": "0", "3xl": "0",
        modal: "4px",
      },
    },
  },
};
```

### 5.4 UI Layout

One centred column, max-width 640px, vertically centred in the viewport.

```
┌──────────────────────────────────────┐
│  SJEL STITCH                         │  ← Bebas Neue, text-5xl, tracking-[0.2em]
│  SVG → DST Converter                 │  ← Space Mono, text-xs, text-muted, uppercase
├──────────────────────────────────────┤
│                                      │
│   ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
│     DROP SVG OR PNG HERE              │  ← DropZone
│     OR CLICK TO SELECT               │  ← dashed border-border, 2px
│                                      │
│     [ CONVERT ]                      │  ← LiquidButton primary (disabled until file)
│   └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ STATUS                         │  │  ← StatusBar (hidden until action)
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ ↓ DOWNLOAD  design_embroidery  │  │  ← ResultCard (hidden until done)
│  │            .zip                │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

### 5.5 Component: `DropZone.tsx`

```tsx
// Dashed border, 2px, color-border — becomes border-subtle on drag-over
// Background: bg-surface — goes to bg-elevated on drag-over
// Inner label: Space Mono, text-xs, uppercase, tracking-widest, text-muted
// Hidden <input type="file" accept=".svg,.png,image/svg+xml,image/png" />
// Accepted file name shown below the label once selected (text-secondary, text-sm)
// Reset button (×) — ghost LiquidButton sm, shown only when file selected
```

### 5.6 Component: LiquidButton (replicate from Discovery)

Four L-shaped corner ticks (two `border` lines each, positioned absolutely).
On hover: ticks extend + button inverts (solid `accent` ground / `bg-base`
label). CSS-only transition.

```tsx
// variant="primary" | "ghost"
// size="default" | "sm"
// label: font-mono uppercase tracking-widest text-sm
```

### 5.7 Component: `StatusBar.tsx`

```
idle      → hidden
uploading → SPACE MONO label: "PROCESSING…" + animated border-pulse on outer border
error     → label: "CONVERSION FAILED" (text-muted), message below (text-faint text-xs)
done      → label: "READY" (text-accent)
```

### 5.8 Component: `ResultCard.tsx`

Shown only on success.

```
bg-surface border border-border p-6
├── Space Mono badge "DST + PES + THREAD LIST" (accent/10 fill, accent border)
├── Bebas Neue filename, text-2xl
└── LiquidButton primary "↓ DOWNLOAD"
```

Triggers `window.URL.createObjectURL(blob)` + auto-click anchor. Card stays
visible until a new file is selected.

---

## 6. API contract (`frontend/src/api.ts`)

```typescript
export type ConvertResult =
  | { status: "ok";    blob: Blob; filename: string }
  | { status: "error"; message: string };

export async function convertFile(file: File): Promise<ConvertResult> {
  const body = new FormData();
  body.append("file", file);

  const res = await fetch("/stitch/api/convert", {
    method: "POST",
    body,
  });

  if (!res.ok) {
    const { detail } = await res.json().catch(() => ({ detail: "Unknown error" }));
    return { status: "error", message: detail };
  }

  const blob = await res.blob();
  const filename =
    res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1]
    ?? "embroidery.zip";

  return { status: "ok", blob, filename };
}
```

---

## 7. Docker

### 7.1 `frontend/Dockerfile`

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 4173
```

### 7.2 `frontend/nginx.conf`

```nginx
server {
  listen 4173;
  root /usr/share/nginx/html;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }
}
```

### 7.3 `docker-compose.yml` (stitch-only excerpt)

Add these two services to the Discovery compose file:

```yaml
  stitch-frontend:
    build:
      context: ./stitch/frontend
    restart: unless-stopped
    networks: [sjel]

  stitch-backend:
    build:
      context: ./stitch/backend
    restart: unless-stopped
    networks: [sjel]
    # No volumes — all processing is in-memory tmpdir
```

### 7.4 Caddy block (add to existing Caddyfile)

```caddyfile
discovery.sjel.net {
  # … existing Discovery blocks …

  handle /stitch/api/* {
    uri strip_prefix /stitch/api
    reverse_proxy stitch-backend:8001
  }

  handle /stitch/* {
    uri strip_prefix /stitch
    reverse_proxy stitch-frontend:4173
  }
}
```

---

## 8. Known constraints & risks

| ID | Severity | Note |
|---|---|---|
| C-001 | 🟡 watch | Ink/Stitch release ZIP must be the **arm64 Linux** build. Check the GitHub releases page for the exact asset name — it changes per version. |
| C-002 | 🟡 watch | Auto-stitch quality from headless Ink/Stitch is **design-dependent**. Clean SVGs with solid-filled paths (SJEL logos) work well. Complex gradients or very fine details need manual tuning in Inkscape before converting. Request a physical sample from the supplier before bulk order. |
| C-003 | 🟢 noted | PNG → SVG via Potrace produces a traced outline, not a color-separated SVG. For multi-color designs, provide an SVG directly. |
| C-004 | 🟢 noted | Processing time on Pi 5 is estimated at 5–20s per file depending on stitch count. The frontend should keep the button disabled + show the "PROCESSING…" state for the full duration. No timeout below 60s. |
| C-005 | 🟢 noted | Ink/Stitch headless CLI binary location inside its release zip varies by version. After install, locate with `find / -name "inkstitch" -type f`. |

---

## 9. Repository layout

```
sjel/
  discovery/        ← existing
  stitch/           ← new
    backend/
      main.py
      requirements.txt
      Dockerfile
    frontend/
      src/
        App.tsx
        api.ts
        components/
          DropZone.tsx
          LiquidButton.tsx
          StatusBar.tsx
          ResultCard.tsx
        styles/
          index.css
      tailwind.config.ts
      vite.config.ts
      nginx.conf
      Dockerfile
    docs/
      LOGBOOK.md      ← implementation diary
      HOTSPOTS.md     ← issues waiting for dev input
      SCRATCH.md      ← active reasoning pad
    SPEC.md           ← this file
  docker-compose.yml  ← shared, both apps
  Caddyfile
```

---

## 10. Roadmap

### Phase 1 — Backend (est. ~4h)
- [ ] Write `main.py` with `/health` + `/convert`
- [ ] Write `backend/Dockerfile`, verify Ink/Stitch installs on arm64
- [ ] Smoke-test: `docker build`, upload a SJEL SVG, get a valid DST out
- [ ] Find exact `inkstitch` binary path, hardcode or `$PATH`

### Phase 2 — Frontend (est. ~4h)
- [ ] Scaffold Vite + React + TypeScript + Tailwind
- [ ] Copy token block from Discovery `index.css`
- [ ] Build `DropZone`, `LiquidButton`, `StatusBar`, `ResultCard`
- [ ] Wire `api.ts`, test full round-trip locally (`vite dev` → backend)

### Phase 3 — Docker + Caddy (est. ~1h)
- [ ] Add two services to compose file
- [ ] Add Caddy blocks
- [ ] Deploy on Pi, end-to-end test

### Phase 4 — Quality validation (est. ongoing)
- [ ] Convert SJEL logo SVG → send DST to test supplier (Quanzhou Shengke, MOQ=2)
- [ ] Evaluate physical sample, adjust stitch density in SVG if needed
- [ ] If adjustment needed: document which Ink/Stitch stitch-type params to
  embed in the SVG (fill stitch vs satin etc.) so the CLI picks them up

---

*SJEL STITCH — internal tooling. Not exposed publicly.*
