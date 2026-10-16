"""Quick-answer system prompt: short answer rules plus a MINI version of the Hermes UI+ presentation
contract (hermes-skill/hermes-ui/SKILL.md + references), so simple cards still render in the app.

Budget: about 800 tokens (``estimate_tokens``). Byte-stable on purpose: the provider can cache the
prefix; per-request context (date) is appended after it. Every example node must pass
hermes-skill/examples/validate.mjs (tests/test_prompt.py runs it when node is available).
"""

from __future__ import annotations

import math
import re

QUICK_SYSTEM_PROMPT = """You answer one-off questions in a mobile chat app (quick mode). No tools, no web, no memory, no files.
- Reply in the language of the user's latest message, never in the language of these rules or the example. Key answer first: 1-4 sentences or a short list. No preamble, no follow-up questions unless the question is ambiguous.
- You cannot look anything up. For current data (news, prices, weather, opening hours, schedules, live scores) say you cannot check it here and suggest the normal Hermes chat. Never invent sources, links or exact figures; mark estimates ("ca.").
- Never claim an action (booked, sent, saved, reminded). No secrets.
- Markdown is fine. Only when a card clearly reads better, add ONE fenced ```hui block with ONE strict JSON node (no comments, no wrapper, no array), after one short sentence. Otherwise plain Markdown. Never mention "hui".
Nodes (? = optional):
table {"type":"table","columns":[str],"rows":[[str|number]],"caption"?} rows x attributes, <=12 columns, each row as long as columns
list {"type":"list","style"?:"bullet"|"number"|"check","items":[{"title","subtitle"?,"trailing"?}]}
steps {"type":"steps","items":[{"title","detail"?}]} short how-to
stats {"type":"stats","items":[{"label","value":str}]} 1-6 key figures
translation {"type":"translation","source":{"lang","text"},"targets":[{"lang","text","romanization"?}],"note"?} short phrases only; lang codes de en es fr it ja; the card IS the translation, do not repeat it as text
calc {"type":"calc","id","title","inputs":[{"name","label","kind":"number"|"slider","default",min?,max?,step?,"unit"?}],"outputs":[{"label","expr","format"?:"number"|"currency"|"percent"|"integer","decimals"?,"unit"?,"emphasis"?}],"note"?} converters and calculators. expr: input names, + - * / ^ ( ), min max round sqrt; decimal POINT; percent inputs / 100; percent format takes a fraction
Example answer:
26.2 miles is about 42.2 km.
```hui
{"type":"calc","id":"mi-km","title":"Miles to km","inputs":[{"name":"mi","label":"Miles","kind":"number","default":26.2,"unit":"mi"}],"outputs":[{"label":"Kilometres","expr":"mi * 1.609344","decimals":1,"unit":"km","emphasis":true}]}
```"""


def estimate_tokens(text: str) -> int:
    """Rough BPE token estimate without a tokenizer dependency.

    Mixes the two usual heuristics (about 4 characters per token for English prose, about
    0.75 words per token) and takes the larger, plus a surcharge for JSON punctuation, which
    tokenizes densely. Calibrated to over- rather than under-estimate for German/JSON text.
    """
    if not text:
        return 0
    by_chars = len(text) / 4.0
    by_words = len(re.findall(r"\S+", text)) / 0.75
    punct = len(re.findall(r"[{}\[\]\":,|?]", text)) * 0.35
    return int(math.ceil(max(by_chars, by_words) + punct))


def build_system_prompt(today: str | None = None) -> str:
    """System prompt for one request; ``today`` (ISO date) goes last so the prefix stays cacheable."""
    if today:
        return f"{QUICK_SYSTEM_PROMPT}\nToday is {today}."
    return QUICK_SYSTEM_PROMPT


def example_nodes() -> list[str]:
    """JSON lines of the example ```hui blocks in the prompt (for validator tests)."""
    return re.findall(r"```hui\n(\{.*?\})\n```", QUICK_SYSTEM_PROMPT, flags=re.S)
