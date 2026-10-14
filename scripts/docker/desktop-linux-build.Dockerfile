# Build image of scripts/build-desktop-linux.sh: the Tauri Linux build toolchain on an OLD glibc, so the AppImage / .deb
# run on every distribution from Ubuntu 22.04 / Debian 12 (glibc 2.35) upwards. A binary requires the glibc of the
# machine it was linked on, so the base image decides the minimum supported distribution.
#
# Built by the script on the build host (docker build -t hermes-desktop-build:<base>-<hash of this file>); the image is
# kept for the next build (LINUX_IMAGE_REFRESH=1 rebuilds it with current apt packages and Node 22.x). Rust is pinned
# (RUST_VERSION; script env LINUX_RUST_VERSION): the same compiler gives the same binary layout, which matters to the
# flavor guard, since short readable byte runs in .rodata can coincide with short denylist terms by chance.
# Runs as an arbitrary unprivileged uid (HOME, cargo home, caches are set by the script): the toolchains are installed
# world-readable below /opt and /usr/local.
ARG BASE=ubuntu:22.04
FROM ${BASE}
ARG RUST_VERSION=1.97.1
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential pkg-config curl wget file git ca-certificates xz-utils dpkg-dev patchelf squashfs-tools \
      desktop-file-utils libssl-dev libxdo-dev libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev \
 && rm -rf /var/lib/apt/lists/*

# Node 22 (latest 22.x, checksum-verified)
RUN set -eux; \
    base=https://nodejs.org/dist/latest-v22.x; \
    curl -fsSL "$base/SHASUMS256.txt" -o /tmp/SHASUMS256.txt; \
    f="$(sed -n 's/^[0-9a-f]\{64\}  \(node-v22[0-9.]*-linux-x64\.tar\.xz\)$/\1/p' /tmp/SHASUMS256.txt)"; \
    [ -n "$f" ]; \
    curl -fsSL "$base/$f" -o "/tmp/$f"; \
    (cd /tmp && grep "  $f\$" SHASUMS256.txt | sha256sum -c -); \
    tar -xJf "/tmp/$f" -C /usr/local --strip-components=1 --no-same-owner; \
    rm -f /tmp/SHASUMS256.txt "/tmp/$f"; \
    node -v && npm -v

# Rust (pinned, minimal profile); the per-build cargo home (registry, git) is set at run time
ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH=/opt/cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain "${RUST_VERSION}" \
 && chmod -R a+rX /opt/rustup /opt/cargo \
 && rustc -V && cargo -V
