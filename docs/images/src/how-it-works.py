#!/usr/bin/env python3
"""Generates docs/images/how-it-works.svg and how-it-works-dark.svg (README "How it works").

GitHub shows SVGs as <img>, which cannot load webfonts, so every text run is shaped with HarfBuzz using the
website's own fonts (website/fonts, SIL OFL) and written as glyph outlines. Colours follow website/style.css.

    python3 -m venv /tmp/svgenv && /tmp/svgenv/bin/pip install fonttools brotli uharfbuzz
    /tmp/svgenv/bin/python docs/images/src/how-it-works.py
"""
import io
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[3]
FONTS = ROOT / "website" / "fonts"
OUT = ROOT / "docs" / "images"

THEMES = {
    "light": dict(bg="#f1f0ec", card="#fefefc", line="#e2dfd6", ink="#15120e", ink2="#3d352b", ink3="#6a5e4e",
                  brass="#b8862e", brass_ink="#7a5714", chip="#f5f3ec", wax="#a3201d", screen="#f5f3ec",
                  shadow="rgba(60,38,8,0.22)"),
    "dark": dict(bg="#161412", card="#221f1b", line="#3a342c", ink="#f1ece2", ink2="#d9d1c3", ink3="#a99d8b",
                 brass="#e6c277", brass_ink="#e6c277", chip="#2b2722", wax="#cf4632", screen="#2b2722",
                 shadow="rgba(0,0,0,0.55)"),
}


class Face:
    def __init__(self, key, file, wght=None):
        font = TTFont(FONTS / file)
        if wght is not None:
            font = instantiateVariableFont(font, {"wght": wght})
        font.flavor = None
        buf = io.BytesIO()
        font.save(buf)
        self.key, self.font = key, font
        self.upm = font["head"].unitsPerEm
        self.glyphs = font.getGlyphSet()
        self.order = font.getGlyphOrder()
        self.hb = hb.Font(hb.Face(buf.getvalue()))
        self.used = {}

    def shape(self, text):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hb, buf, {"kern": True, "liga": True})
        out, x = [], 0
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            name = self.order[info.codepoint]
            if name not in self.used:
                pen = SVGPathPen(self.glyphs, lambda v: f"{v:.0f}")
                self.glyphs[name].draw(pen)
                self.used[name] = pen.getCommands()
            out.append((name, x + pos.x_offset))
            x += pos.x_advance
        return out, x

    def width(self, text, size):
        return self.shape(text)[1] * size / self.upm


SERIF = Face("s", "gloock-regular.woff2")
SANS = Face("a", "atkinson-hyperlegible-next-var.woff2", 400)
SANS_B = Face("b", "atkinson-hyperlegible-next-var.woff2", 700)
MONO = Face("m", "jetbrains-mono-var.woff2", 500)


def text(face, s, size, x, y, fill, anchor="start"):
    glyphs, adv = face.shape(s)
    k = size / face.upm
    if anchor == "middle":
        x -= adv * k / 2
    elif anchor == "end":
        x -= adv * k
    uses = "".join(f'<use href="#{face.key}-{n}" x="{gx}"/>' for n, gx in glyphs if face.used[n])
    return (f'<g fill="{fill}" transform="translate({x:.1f} {y:.1f}) scale({k:.5f} {-k:.5f})">{uses}</g>')


def chip(s, cx, y, c, mono=True):
    face, size = (MONO, 16) if mono else (SANS_B, 16)
    w = face.width(s, size) + 26
    return (f'<rect x="{cx - w / 2:.1f}" y="{y}" width="{w:.1f}" height="30" rx="15" fill="{c["chip"]}" '
            f'stroke="{c["line"]}"/>' + text(face, s, size, cx, y + 20, c["ink2"], "middle"))


def arrow(x1, x2, y, c, dashed=False):
    d = ' stroke-dasharray="6 6"' if dashed else ""
    head = 10 if x2 > x1 else -10
    return (f'<path d="M{x1} {y}H{x2 - head}" stroke="{c["brass"]}" stroke-width="2.5" stroke-linecap="round"{d}/>'
            f'<path d="M{x2} {y}l{-head * 1.4:.0f} -7v14z" fill="{c["brass"]}"/>')


def build(c):
    W, H = 1330, 520
    cw, ch, top = 270, 300, 60
    xs = [40, 530, 1020]
    centers = [x + cw / 2 for x in xs]
    p = [f'<rect width="{W}" height="{H}" rx="28" fill="{c["bg"]}"/>']
    for x in xs:
        p.append(f'<rect x="{x}" y="{top}" width="{cw}" height="{ch}" rx="22" fill="{c["card"]}" '
                 f'stroke="{c["line"]}" stroke-width="1.5" filter="url(#sh)"/>')

    # 1 · the app: phone + laptop
    cx = centers[0]
    px, py = cx - 78, top + 42
    p.append(f'<rect x="{px}" y="{py}" width="54" height="96" rx="11" fill="{c["screen"]}" stroke="{c["ink"]}" stroke-width="3"/>'
             f'<rect x="{px + 9}" y="{py + 22}" width="30" height="7" rx="3.5" fill="{c["brass"]}"/>'
             f'<rect x="{px + 9}" y="{py + 36}" width="36" height="5" rx="2.5" fill="{c["line"]}"/>'
             f'<rect x="{px + 9}" y="{py + 46}" width="26" height="5" rx="2.5" fill="{c["line"]}"/>'
             f'<rect x="{px + 9}" y="{py + 66}" width="36" height="14" rx="7" fill="{c["ink"]}"/>'
             f'<circle cx="{px + 52}" cy="{py + 2}" r="9" fill="{c["wax"]}" stroke="{c["card"]}" stroke-width="3"/>')
    lx, ly = cx - 6, top + 66
    p.append(f'<rect x="{lx}" y="{ly}" width="88" height="58" rx="7" fill="{c["screen"]}" stroke="{c["ink"]}" stroke-width="3"/>'
             f'<rect x="{lx + 10}" y="{ly + 12}" width="18" height="34" rx="3" fill="{c["line"]}"/>'
             f'<rect x="{lx + 34}" y="{ly + 14}" width="42" height="6" rx="3" fill="{c["brass"]}"/>'
             f'<rect x="{lx + 34}" y="{ly + 26}" width="34" height="5" rx="2.5" fill="{c["line"]}"/>'
             f'<path d="M{lx - 10} {ly + 66}h108l-8 -8h-92z" fill="{c["ink"]}"/>')
    # the brand "+" as on the website: sans bold, small, raised
    tw, pw = SERIF.width("Hermes UI", 36), SANS_B.width("+", 20)
    p.append(text(SERIF, "Hermes UI", 36, cx - pw / 2, top + 208, c["ink"], "middle"))
    p.append(text(SANS_B, "+", 20, cx - pw / 2 + tw / 2 + 2, top + 194, c["ink"]))
    p.append(text(SANS, "Android · Web · macOS · Linux", 18, cx, top + 240, c["ink3"], "middle"))

    # 2 · the bridge
    cx = centers[1]
    p.append(text(SERIF, "UI-Bridge", 36, cx, top + 62, c["ink"], "middle"))
    p.append(text(SANS, "Node, runs next to Hermes", 18, cx, top + 92, c["ink3"], "middle"))
    for row, items in ((top + 120, ["router", "uploads", "voice"]), (top + 160, ["pairing", "push"])):
        widths = [MONO.width(s, 16) + 26 for s in items]
        x = cx - (sum(widths) + 8 * (len(items) - 1)) / 2
        for s, w in zip(items, widths):
            p.append(chip(s, x + w / 2, row, c))
            x += w + 8
    ky = top + 246
    kw = SANS_B.width("keeps the Hermes API key", 17)
    kx = cx - (kw + 34) / 2
    p.append(f'<circle cx="{kx + 8}" cy="{ky - 6}" r="7" fill="none" stroke="{c["brass"]}" stroke-width="2.5"/>'
             f'<path d="M{kx + 15} {ky - 6}h13m-4 0v6m-5 -6v4" stroke="{c["brass"]}" stroke-width="2.5" '
             f'fill="none" stroke-linecap="round"/>')
    p.append(text(SANS_B, "keeps the Hermes API key", 17, kx + 34, ky, c["brass_ink"]))

    # 3 · Hermes
    cx = centers[2]
    p.append(text(SERIF, "Hermes Agent", 36, cx, top + 62, c["ink"], "middle"))
    p.append(text(SANS, "API server, your machine", 18, cx, top + 92, c["ink3"], "middle"))
    p.append(chip("+ hermes-ui skill", cx, top + 120, c))
    for i, s in enumerate(["models, tools, memory", "unchanged for Telegram,", "cron and other clients"]):
        p.append(text(SANS, s, 17, cx, top + 196 + i * 26, c["ink2"], "middle"))

    # arrows + labels
    a1, a2 = xs[0] + cw + 14, xs[1] - 14
    b1, b2 = xs[1] + cw + 14, xs[2] - 14
    ya, yb = top + 120, top + 180
    mid1, mid2 = (a1 + a2) / 2, (b1 + b2) / 2
    p.append(arrow(a1, a2, ya, c) + arrow(a2, a1, yb, c))
    p.append(text(SANS_B, "HTTPS + device token", 18, mid1, ya - 14, c["ink2"], "middle"))
    p.append(text(SANS_B, "live stream + push", 18, mid1, yb + 28, c["ink2"], "middle"))
    aw = SANS.width("approvals", 16)
    p.append(f'<circle cx="{mid1 - aw / 2 - 6}" cy="{yb + 47}" r="6" fill="{c["wax"]}"/>')
    p.append(text(SANS, "approvals", 16, mid1 + 6, yb + 52, c["ink3"], "middle"))
    p.append(arrow(b1, b2, ya, c) + arrow(b2, b1, yb, c))
    p.append(text(SANS_B, "HTTP + API key", 18, mid2, ya - 14, c["ink2"], "middle"))
    p.append(text(SANS_B, "answer stream", 18, mid2, yb + 28, c["ink2"], "middle"))

    # optional direct connection, below the bridge
    yd = top + ch + 56
    x0, x3 = centers[0], centers[2]
    p.append(f'<path d="M{x0} {top + ch + 12}V{yd - 14}q0 14 14 14H{x3 - 14}q14 0 14 -14V{top + ch + 26}" '
             f'fill="none" stroke="{c["ink3"]}" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round"/>'
             f'<path d="M{x3} {top + ch + 12}l-7 14h14z" fill="{c["ink3"]}"/>')
    label = "optional: “Connect without the bridge” (API key in the app, no bridge features)"
    lw = SANS.width(label, 17) + 30
    p.append(f'<rect x="{W / 2 - lw / 2:.1f}" y="{yd - 17}" width="{lw:.1f}" height="34" rx="17" fill="{c["bg"]}" '
             f'stroke="{c["line"]}" stroke-width="1.5"/>')
    p.append(text(SANS, label, 17, W / 2, yd + 6, c["ink3"], "middle"))
    p.append(text(SANS_B, "With the bridge, the app never sees your Hermes API key.", 19, W / 2, H - 34,
                  c["ink"], "middle"))

    body = "".join(p)
    defs = "".join(f'<path id="{f.key}-{n}" d="{d}"/>' for f in (SERIF, SANS, SANS_B, MONO)
                   for n, d in f.used.items() if d)
    title = ("How it works: the HUI+ app talks over HTTPS with a device token to the UI-Bridge, which runs "
             "next to Hermes and keeps the Hermes API key; the bridge talks HTTP with the API key to the Hermes "
             "Agent API server with the hermes-ui skill.")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
            f'role="img" aria-label="{title}"><title>{title}</title><defs>'
            f'<filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="10" '
            f'stdDeviation="12" flood-color="{c["shadow"]}"/></filter>{defs}</defs>{body}</svg>\n')


if __name__ == "__main__":
    for name, theme in THEMES.items():
        for f in (SERIF, SANS, SANS_B, MONO):
            f.used.clear()
        out = OUT / ("how-it-works.svg" if name == "light" else "how-it-works-dark.svg")
        out.write_text(build(theme), encoding="utf-8")
        print(out.relative_to(ROOT), out.stat().st_size, "bytes")
