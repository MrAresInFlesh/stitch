FROM python:3.11-slim

# Runtime libs needed by the bundled Ink/Stitch CLI below (it links wx
# for its GUI toolkit even in headless/CLI mode) + potrace for the PNG
# pre-step. No system Inkscape package needed: Ink/Stitch's Linux
# release is a fully self-contained PyInstaller bundle, not an Inkscape
# extension you install into an existing Inkscape (see HOTSPOT-001 in
# docs/HOTSPOTS.md for how that was verified).
RUN apt-get update && apt-get install -y --no-install-recommends \
        potrace \
        curl \
        xz-utils \
        libgtk-3-0 \
        libwayland-cursor0 \
        libwayland-egl1 \
        libxkbcommon0 \
        libsm6 \
        libice6 \
        libxtst6 \
        libnotify4 \
        libdrm2 \
        libgl1 \
        libegl1 \
    && rm -rf /var/lib/apt/lists/*

# Ink/Stitch ships one tar.xz per architecture (no generic "linux.zip" —
# that asset name never existed on the releases page). BuildKit sets
# TARGETARCH automatically; map it to Ink/Stitch's own arch naming.
ARG INKSTITCH_VERSION=3.3.0
ARG TARGETARCH
RUN set -eu; \
    case "$TARGETARCH" in \
        arm64)  IS_ARCH=aarch64 ;; \
        amd64)  IS_ARCH=x86_64  ;; \
        *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSL \
        "https://github.com/inkstitch/inkstitch/releases/download/v${INKSTITCH_VERSION}/inkstitch-${INKSTITCH_VERSION}-linux-${IS_ARCH}.tar.xz" \
        -o /tmp/inkstitch.tar.xz \
    && mkdir -p /opt/inkstitch \
    && tar -xJf /tmp/inkstitch.tar.xz -C /opt/inkstitch --strip-components=1 \
    && rm /tmp/inkstitch.tar.xz

ENV PATH="/opt/inkstitch/bin:${PATH}"

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
