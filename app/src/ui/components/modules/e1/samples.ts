/** Gallery / demo samples of the `paths` and `blocks` nodes (pure data, also checked in e1.test.ts / blocks.test.ts). */

/** "Where do the files live?" – native macOS vs. VM disk vs. shared folder (German). */
export const PATHS_FILES_DE = {
  type: 'paths',
  id: 'dateien-ort',
  title: 'Wo liegen die Dateien?',
  items: [
    {
      id: 'nativ',
      title: 'Nativ in macOS',
      badge: { text: 'Ausgangsbasis', tone: 'neutral' },
      path: [{ label: 'macOS', icon: 'laptop' }, { label: 'APFS', icon: 'disk' }, { label: 'interne SSD', icon: 'disk' }],
      note: 'Schnellster Zugriff, Time Machine sichert alles mit.',
    },
    {
      id: 'vm-disk',
      title: 'In der VM-Disk',
      badge: { text: 'Vermeiden', tone: 'bad' },
      path: [{ label: 'macOS', icon: 'laptop' }, { label: 'Linux-VM', icon: 'vm' }, { label: 'ext4-Image', icon: 'file' }, { label: 'SSD', icon: 'disk' }],
      note: 'Alles steckt in einer großen Image-Datei – Zugriff und Backup aus macOS sind umständlich.',
    },
    {
      id: 'geteilt',
      title: 'Geteilter Ordner',
      badge: { text: 'Interessant', tone: 'good' },
      path: [{ label: 'Linux-VM', icon: 'vm' }, { label: 'virtiofs', icon: 'folder' }, { label: 'macOS-Ordner', icon: 'folder' }, { label: 'APFS', icon: 'disk' }],
      note: 'Linux-Werkzeuge in der VM, die Dateien bleiben in macOS sichtbar und gesichert.',
    },
    {
      id: 'nas',
      title: 'Auf dem NAS',
      badge: { text: 'Mit Vorsicht', tone: 'warn' },
      path: [{ label: 'macOS', icon: 'laptop' }, { label: 'SMB', icon: 'network' }, { label: 'NAS', icon: 'disk' }],
      note: 'Gut für Archive, langsam bei vielen kleinen Dateien.',
    },
  ],
};

/** "How does a request travel?" – app → bridge → Hermes (English). */
export const PATHS_REQUEST_EN = {
  type: 'paths',
  id: 'request-path',
  title: 'How does a request travel?',
  items: [
    {
      id: 'direct',
      title: 'Straight to the API',
      badge: { text: 'Baseline', tone: 'neutral' },
      path: [{ label: 'App', icon: 'phone' }, { label: 'Hermes API', icon: 'server' }],
      note: 'Simplest setup – no router hint and no push.',
    },
    {
      id: 'bridge',
      title: 'Through the bridge',
      badge: { text: 'Recommended', tone: 'good' },
      path: [{ label: 'App', icon: 'phone' }, { label: 'Bridge', icon: 'server', detail: 'router + push' }, { label: 'Hermes', icon: 'server' }],
      note: 'Adds the UI router hint and push notifications.',
    },
    {
      id: 'vpn',
      title: 'Over a private network',
      badge: { text: 'Interesting', tone: 'good' },
      path: [{ label: 'App', icon: 'phone' }, { label: 'VPN', icon: 'lock' }, { label: 'Bridge', icon: 'server' }, { label: 'Hermes', icon: 'server' }],
      note: 'Encrypted end to end without opening a port.',
    },
    {
      id: 'public',
      title: 'Port forward to the internet',
      badge: { text: 'Avoid', tone: 'bad' },
      path: [{ label: 'App', icon: 'phone' }, { label: 'Internet', icon: 'globe' }, { label: 'Router port', icon: 'network' }, { label: 'Hermes', icon: 'server' }],
      note: 'Exposes the API to everyone – use a VPN instead.',
    },
  ],
};

/** Selectable rows (German): "Welcher Backup-Weg?" – a tap sends `[paths:backup-weg] <title>`. */
export const PATHS_BACKUP_SELECT_DE = {
  type: 'paths',
  id: 'backup-weg',
  title: 'Welcher Backup-Weg passt?',
  select: true,
  items: [
    { id: 'tm', title: 'Time Machine lokal', badge: 'Ausgangsbasis', path: ['Mac', 'Time Machine', 'USB-SSD'], note: 'Einfach, aber nur eine Kopie im selben Raum.' },
    { id: 'nas', title: 'Time Machine aufs NAS', badge: { text: 'Interessant', tone: 'good' }, path: [{ label: 'Mac', icon: 'laptop' }, { label: 'SMB', icon: 'network' }, { label: 'NAS', icon: 'disk' }], note: 'Läuft automatisch im Heimnetz.' },
    { id: 'cloud', title: 'Verschlüsselt in die Cloud', badge: { text: 'Mit Vorsicht', tone: 'caution' }, path: 'Mac → restic → Cloud-Speicher', note: 'Kopie außer Haus; Schlüssel gut aufheben.' },
  ],
};

/** Long chain (6 nodes) – wraps on a phone, arrows stay between the nodes (English). */
export const PATHS_RUNTIME_EN = {
  type: 'paths',
  id: 'runtime',
  title: 'Docker vs VM vs bare metal',
  basis: 'estimate',
  items: [
    { title: 'Bare metal', badge: { text: 'Baseline', tone: 'neutral' }, path: [{ label: 'Hardware', icon: 'server' }, { label: 'Linux', icon: 'terminal' }, { label: 'Hermes', icon: 'app' }], note: 'Fastest, but every update touches the host.' },
    { title: 'Docker', badge: { text: 'Recommended', tone: 'good' }, path: [{ label: 'Hardware', icon: 'server' }, { label: 'Linux', icon: 'terminal' }, { label: 'Docker', icon: 'container' }, { label: 'Hermes', icon: 'app' }], note: 'Easy updates and rollback, near-native speed.' },
    { title: 'VM with Docker inside', badge: { text: 'Overkill', tone: 'warn' }, path: [{ label: 'Hardware', icon: 'server' }, { label: 'Hypervisor', icon: 'vm' }, { label: 'Linux guest', icon: 'terminal' }, { label: 'Docker', icon: 'container' }, { label: 'Volume', icon: 'disk' }, { label: 'Hermes', icon: 'app' }], note: 'Strong isolation, two layers to maintain.' },
  ],
};

/** Partial node as it arrives while streaming (first row complete). */
export const PATHS_PARTIAL = { type: 'paths', id: 'paths-part', title: 'Wo liegen die Dateien?', items: [PATHS_FILES_DE.items[0]] };

export const PATHS_SAMPLES: { title: string; node: unknown; streaming?: boolean }[] = [
  { title: 'paths · Dateien: nativ vs VM vs geteilt (de)', node: PATHS_FILES_DE },
  { title: 'paths · request path app → bridge → Hermes (en)', node: PATHS_REQUEST_EN },
  { title: 'paths · Auswahl (select) – Backup-Weg', node: PATHS_BACKUP_SELECT_DE },
  { title: 'paths · long chain wraps (en)', node: PATHS_RUNTIME_EN },
  { title: 'paths · streaming (erste Zeile)', node: PATHS_PARTIAL, streaming: true },
  { title: 'paths · streaming (leer)', node: { type: 'paths', id: 'paths-empty' }, streaming: true },
];

// ── blocks ──

/** macOS: one shared Linux kernel (OrbStack) vs. one kernel per VM (VMPal / Parallels) – German. */
export const BLOCKS_MAC_VM_DE = {
  type: 'blocks',
  id: 'mac-vm-aufbau',
  title: 'Agenten auf dem Mac: geteilter Kernel oder eigene VMs',
  columns: [
    {
      title: 'OrbStack',
      grid: 2,
      items: [
        { label: 'Agent 1', icon: 'container' },
        { label: 'Agent 2', icon: 'container' },
        { label: 'Agent 3', icon: 'container' },
        { label: 'Agent 4', icon: 'container' },
      ],
      base: { label: '1 Linux-Kernel', sub: 'Gemeinsam genutzt', icon: 'terminal' },
    },
    {
      title: 'VMPal / Parallels',
      grid: 2,
      items: [
        { label: 'Agent 1', sub: 'Kernel 1', icon: 'vm', style: 'framed' },
        { label: 'Agent 2', sub: 'Kernel 2', icon: 'vm', style: 'framed' },
        { label: 'Agent 3', sub: 'Kernel 3', icon: 'vm', style: 'framed' },
        { label: 'Agent 4', sub: 'Kernel 4', icon: 'vm', style: 'framed' },
      ],
    },
  ],
  caption: 'Vereinfachtes Architekturmodell – OrbStack teilt einen Kernel, klassische VMs bringen je einen eigenen mit.',
};

/** Hermes UI+ setup: apps → bridge → agent on your server (English). */
export const BLOCKS_HUI_SETUP_EN = {
  type: 'blocks',
  id: 'hui-setup',
  title: 'Hermes UI+ setup',
  columns: [
    {
      title: 'Apps',
      grid: 3,
      items: [
        { label: 'Phone app', icon: 'phone' },
        { label: 'Web app', icon: 'globe' },
        { label: 'Mac app', icon: 'laptop' },
      ],
    },
    {
      title: 'On your server',
      grid: 2,
      items: [
        { label: 'UI-Bridge', sub: 'router + push', icon: 'server', style: 'framed', tone: 'good' },
        { label: 'Hermes Agent', sub: 'tools + memory', icon: 'app', style: 'framed' },
      ],
      base: { label: 'Your server', sub: 'Linux box, NAS or Mac', icon: 'server' },
    },
  ],
  caption: 'Simplified – the apps only talk to the bridge, the bridge forwards every turn to Hermes.',
};

/** Three columns written with model aliases (cols / boxes / shared, string boxes, framed:true, tones) – German. */
export const BLOCKS_RUNTIME_DE = {
  type: 'blocks',
  id: 'laufzeit',
  title: 'Wo läuft Hermes?',
  basis: 'illustrative',
  cols: [
    { title: 'Bare Metal', boxes: [{ label: 'Hermes', icon: 'app' }], shared: { label: 'Host-Linux', icon: 'terminal' } },
    { title: 'Docker', grid: 3, boxes: [{ label: 'Hermes', icon: 'container', tone: 'good' }, { label: 'Bridge', icon: 'container', tone: 'good' }, { label: 'Datenbank', icon: 'database', tone: 'good' }], shared: { label: 'Host-Linux', sub: 'ein Kernel', icon: 'terminal' } },
    { title: 'VM', boxes: [{ label: 'Gast-Linux', subtitle: 'eigener Kernel', framed: true, tone: 'warn' }, 'Hermes'], foundation: { label: 'Hypervisor', icon: 'vm' } },
  ],
  caption: 'Vereinfacht – Docker teilt den Kernel des Hosts, die VM bringt einen eigenen mit.',
};

/** Partial node as it arrives while streaming (first column complete). */
export const BLOCKS_PARTIAL = { type: 'blocks', id: 'blocks-part', title: BLOCKS_MAC_VM_DE.title, columns: [BLOCKS_MAC_VM_DE.columns[0]] };

export const BLOCKS_SAMPLES: { title: string; node: unknown; streaming?: boolean }[] = [
  { title: 'blocks · Mac-VMs: geteilter Kernel vs. eigene Kernel (de)', node: BLOCKS_MAC_VM_DE },
  { title: 'blocks · Hermes UI+ setup (en)', node: BLOCKS_HUI_SETUP_EN },
  { title: 'blocks · drei Spalten, Aliasse, Töne (de)', node: BLOCKS_RUNTIME_DE },
  { title: 'blocks · streaming (erste Spalte)', node: BLOCKS_PARTIAL, streaming: true },
  { title: 'blocks · streaming (leer)', node: { type: 'blocks', id: 'blocks-empty' }, streaming: true },
];
