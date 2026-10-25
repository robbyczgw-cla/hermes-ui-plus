# Runtime for scripts/desktop-check (real desktop app window, headless): the extracted Linux AppImage runs inside
# Xvfb and is driven through WebKitGTK's WebDriver. Ubuntu 22.04 like the AppImage build (desktop-linux-build.Dockerfile).
# Node is mounted from the host (official Node 22), nothing else is installed into the image at run time.
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb xauth webkit2gtk-driver ca-certificates curl socat imagemagick dbus-x11 fonts-dejavu-core fonts-noto-color-emoji \
      libgtk-3-0 libayatana-appindicator3-1 librsvg2-common \
    && rm -rf /var/lib/apt/lists/*
