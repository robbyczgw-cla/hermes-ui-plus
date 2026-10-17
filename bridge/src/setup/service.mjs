// `hermes-ui-plus-bridge setup`, service half: systemd unit (user or system), launchd plist, docker compose
// snippet, and the commands that (re)start them. Pure string builders (tested in test/setup.test.mjs).
import { join } from 'node:path';

export const SERVICE_NAME = 'hermes-ui-plus-bridge';
export const LAUNCHD_LABEL = 'xyz.hermesui.bridge';

/**
 * How the service starts the bridge. A global/local install runs the bin directly; a run from the npx cache
 * (which npm may clean up) starts through npx with the pinned version.
 * @returns {string[]} argv
 */
export function execArgv({ nodePath, binPath, npxPath, version, envFile, fromNpxCache }) {
  // envFile null: systemd loads it via EnvironmentFile= (Astra F05: a DynamicUser cannot read root's 0600 file itself)
  const env = envFile ? ['--env-file', envFile] : [];
  if (fromNpxCache) return [npxPath || 'npx', '-y', `${SERVICE_NAME}@${version}`, ...env];
  return [nodePath, binPath, ...env];
}

/** Is this file inside an npx cache directory? */
export const isNpxCachePath = (p) => /[\\/]_npx[\\/]/.test(String(p));

// GPT security L1: no control characters (a line break would start a new directive); `%` specifiers and `$`
// variable expansion are escaped, quotes/backslashes as before
const CONTROL = /[\u0000-\u001f\u007f]/;
export function assertNoControl(v, what) {
  if (CONTROL.test(String(v))) throw new Error(`${what} must not contain control characters`);
  return String(v);
}
const sdPath = (p) => assertNoControl(p, 'EnvironmentFile path').replace(/%/g, '%%');
const sdQuote = (raw) => {
  const a = assertNoControl(raw, 'service argument').replace(/%/g, '%%').replace(/\$/g, '$$$$');
  return /^[A-Za-z0-9_./:@+=,-]+$/.test(a) ? a : `"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

/**
 * systemd unit. System units (root) get the hardening from bridge/README.md / docs/ROUTER.md: DynamicUser,
 * ProtectSystem=strict, ProtectHome, StateDirectory. User units keep only options an unprivileged systemd
 * manager can apply everywhere (no namespaces), plus StateDirectory (= ~/.local/state/hermes-ui-bridge).
 */
export function systemdUnit({ argv, envFile, system = false, port = 8790, credentials = [] }) {
  const lines = [
    '# Written by `hermes-ui-plus-bridge setup`; re-run it to update (manual edits are overwritten).',
    '[Unit]',
    'Description=Hermes UI+ Bridge',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `EnvironmentFile=${sdPath(envFile)}`,
    `Environment=NODE_ENV=production BRIDGE_PORT=${port}`,
    // files the service user may not read (ProtectHome, root-only modes): systemd copies them into the credentials
    // directory (%d) of this service and the env var points there. EnvironmentFile= wins over Environment=, so the env
    // file must not set the same variable.
    ...credentials.flatMap((c) => {
      if (!/^[A-Za-z0-9_.-]+$/.test(c.name) || !/^[A-Z][A-Z0-9_]*$/.test(c.env)) throw new Error('invalid credential name');
      return [`LoadCredential=${c.name}:${sdPath(c.path)}`, `Environment=${c.env}=%d/${c.name}`];
    }),
    `ExecStart=${argv.map(sdQuote).join(' ')}`,
    'Restart=on-failure',
    'RestartSec=2',
    'TimeoutStopSec=150',
    'StateDirectory=hermes-ui-bridge',
    'StateDirectoryMode=0700',
    'NoNewPrivileges=yes',
    'LockPersonality=yes',
    'RestrictRealtime=yes',
    'RestrictSUIDSGID=yes',
    'MemoryMax=256M',
  ];
  if (system) {
    lines.push(
      'DynamicUser=yes',
      'ProtectSystem=strict',
      'ProtectHome=yes', // the bridge must be installed outside /root and /home (npm i -g), see systemServiceProblem()
      'PrivateTmp=yes',
      'PrivateDevices=yes',
      'ProtectKernelTunables=yes',
      'ProtectKernelModules=yes',
      'ProtectControlGroups=yes',
      'RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX',
    );
  }
  lines.push('', '[Install]', `WantedBy=${system ? 'multi-user.target' : 'default.target'}`, '');
  return lines.join('\n');
}

/**
 * A system unit runs as a dynamic user without access to home directories, so the bridge and node must live
 * outside them (e.g. `npm i -g`). Returns a reason string when that is not the case, '' when fine.
 */
export function systemServiceProblem(argv, { fromNpxCache = false } = {}) {
  if (fromNpxCache) return 'running from the npx cache; a system service needs a global install: npm i -g hermes-ui-plus-bridge, then run hermes-ui-plus-bridge setup again';
  const inHome = argv.slice(0, 2).find((a) => /^\/(root|home)(\/|$)/.test(a));
  return inHome ? `${inHome} is inside a home directory, which the hardened system service cannot read; install globally (npm i -g hermes-ui-plus-bridge) or run setup as a normal user (user service)` : '';
}

export function systemdUnitPath({ system, home, env = {} }) {
  if (system) return `/etc/systemd/system/${SERVICE_NAME}.service`;
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'systemd', 'user', `${SERVICE_NAME}.service`);
}

/** Commands that (re)load and (re)start the unit; idempotent. */
export function systemdCommands({ system }) {
  const sc = system ? ['systemctl'] : ['systemctl', '--user'];
  return [
    [...sc, 'daemon-reload'],
    [...sc, 'enable', `${SERVICE_NAME}.service`],
    [...sc, 'restart', `${SERVICE_NAME}.service`],
  ];
}

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** launchd agent plist (macOS, per user). */
export function launchdPlist({ argv, home, port = 8790, path = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin' }) {
  const log = join(home, 'Library', 'Logs', `${SERVICE_NAME}.log`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Written by \`hermes-ui-plus-bridge setup\`; re-run it to update. -->
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argv.map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>BRIDGE_PORT</key><string>${port}</string>
    <key>PATH</key><string>${xml(path)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

export const launchdPlistPath = (home) => join(home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);

/** bootout (ignore failure) + bootstrap = idempotent reload. */
export function launchdCommands({ uid, plistPath }) {
  return [
    { argv: ['launchctl', 'bootout', `gui/${uid}/${LAUNCHD_LABEL}`], ignoreFailure: true },
    { argv: ['launchctl', 'bootstrap', `gui/${uid}`, plistPath] },
  ];
}

/** docker compose service for the bridge, reading the same env file. */
export function composeSnippet({ envFile, port = 8790, hermesPort = 8642, webDir = '', hermesHome = '' }) {
  // the env file's BRIDGE_WEB_DIR is a host path: mount it and point the container at the mount instead
  const web = webDir ? { env: '\n      BRIDGE_WEB_DIR: /web', volume: `\n      - ${JSON.stringify(`${webDir}:/web:ro`)}` } : { env: '', volume: '' };
  // Hermes' home, read-only: the startup check sees the hermes-ui skill there (Hermes 0.21.5 to 0.22.2 cannot list
  // skills over the API), and the bridge lists Hermes profiles
  const home = hermesHome
    ? { env: '\n      HERMES_HOME: /hermes-home', volume: `\n      - ${JSON.stringify(`${hermesHome}:/hermes-home:ro`)}` } : { env: '', volume: '' };
  return `# docker-compose.yml (build from the bridge directory of the repo, or use your own image name)
services:
  bridge:
    build: .
    image: ${SERVICE_NAME}:local
    restart: unless-stopped
    env_file: [${JSON.stringify(envFile)}]
    environment:
      # Hermes on the Docker host: 127.0.0.1 inside the container is the container itself
      HERMES_BASE_URL: http://host.docker.internal:${hermesPort}
      BRIDGE_HOST: 0.0.0.0
      BRIDGE_PORT: "8790"
      BRIDGE_STATE_DIR: /var/lib/hermes-ui-bridge${web.env}${home.env}
    ports:
      - "127.0.0.1:${port}:8790"   # loopback only; tailscale serve / a TLS proxy goes in front
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - bridge-data:/var/lib/hermes-ui-bridge${web.volume}${home.volume}
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
volumes:
  bridge-data:
# Pair a device: docker compose exec bridge node bin/hermes-ui-bridge.mjs devices add "Phone"
`;
}
