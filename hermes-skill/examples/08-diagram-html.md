# 08 Diagramm (hui-html, SVG)

Router-Hint: `UI-ROUTER-HINT: format=diagram confidence=0.91 - Funktionsweise erklären`

Nutzer: Erklär mir, wie ein Reverse-Proxy funktioniert.

Assistent:
````markdown
Ein Reverse-Proxy steht vor deinen Servern und nimmt alle Anfragen entgegen. Er leitet sie an den passenden Dienst weiter und schickt die Antwort zurück. Von außen sieht man nur den Proxy, nie die Server dahinter.

```hui-html
<svg width="100%" viewBox="0 0 340 330" role="img" aria-label="Browser sendet Anfrage an Reverse-Proxy, dieser leitet an Dienst A oder B weiter">
<defs><marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
<rect x="90" y="12" width="160" height="40" rx="8" fill="rgba(29,158,117,.16)" stroke="#1D9E75"/>
<text x="170" y="32" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="500" fill="var(--h-text)">Browser</text>
<line x1="170" y1="52" x2="170" y2="88" stroke="#1D9E75" stroke-width="1.5" marker-end="url(#ar)"/>
<text x="182" y="70" font-size="12" fill="var(--h-muted)">example.org/app</text>
<rect x="60" y="92" width="220" height="56" rx="8" fill="rgba(127,119,221,.16)" stroke="#7F77DD"/>
<text x="170" y="110" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="500" fill="var(--h-text)">Reverse-Proxy</text>
<text x="170" y="130" text-anchor="middle" dominant-baseline="central" font-size="12" fill="var(--h-muted)">TLS, Routing, Caching</text>
<path d="M130 148 L130 176 L80 176 L80 200" fill="none" stroke="#7F77DD" stroke-width="1.5" marker-end="url(#ar)"/>
<path d="M210 148 L210 176 L260 176 L260 200" fill="none" stroke="#7F77DD" stroke-width="1.5" marker-end="url(#ar)"/>
<rect x="16" y="204" width="128" height="52" rx="8" fill="rgba(55,138,221,.16)" stroke="#378ADD"/>
<text x="80" y="222" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="500" fill="var(--h-text)">Dienst A</text>
<text x="80" y="240" text-anchor="middle" dominant-baseline="central" font-size="12" fill="var(--h-muted)">/app, Port 3000</text>
<rect x="196" y="204" width="128" height="52" rx="8" fill="rgba(55,138,221,.16)" stroke="#378ADD"/>
<text x="260" y="222" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="500" fill="var(--h-text)">Dienst B</text>
<text x="260" y="240" text-anchor="middle" dominant-baseline="central" font-size="12" fill="var(--h-muted)">/api, Port 8080</text>
<text x="170" y="288" text-anchor="middle" font-size="12" fill="var(--h-muted)">Antworten laufen den gleichen Weg zurück</text>
<text x="170" y="308" text-anchor="middle" font-size="12" fill="var(--h-muted)">Interne Server sind von außen nicht erreichbar</text>
</svg>
```

Typische Programme dafür sind Caddy, nginx und Traefik.

```hui
{"type":"suggestions","items":["Beispiel-Config für Caddy","Unterschied zu einem Forward-Proxy"]}
```
````
