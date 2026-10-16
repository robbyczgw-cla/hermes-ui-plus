// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// babel-preset-expo inlines EXPO_PUBLIC_* at transform time, but Metro's transform cache ($TMPDIR/metro-cache) is not
// keyed on them: a build of one flavor reused the other flavor's cached modules (a personal APK ran as hermes).
// cacheVersion is part of every transform cache key, so it carries a hash of all EXPO_PUBLIC_* values (docs/BUILD.md
// "Flavor mark + Metro cache"). The build scripts check the result anyway (scripts/verify-flavor-artifact.mjs).
const publicEnv = Object.keys(process.env)
  .filter((k) => k.startsWith('EXPO_PUBLIC_'))
  .sort()
  .map((k) => `${k}=${process.env[k]}`)
  .join('\n');
const publicEnvHash = require('crypto').createHash('sha256').update(publicEnv).digest('hex').slice(0, 16);
config.cacheVersion = `${config.cacheVersion ?? ''}|expo-public:${publicEnvHash}`;

const i18nCore = path.join(__dirname, 'src/i18n/core.ts');
const i18nDictsApp = path.join(__dirname, 'src/i18n/dicts.app.ts');
const upstreamResolve = config.resolver.resolveRequest;
// perf builds, level 2 (app/src/perf/probe.ts, docs/PERF.md): React's profiling renderer, so <Profiler onRender> reports
// render times in a release bundle; every other build keeps the production renderer
const reactProfiling = process.env.EXPO_PUBLIC_HUI_PERF === '2';
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // i18n: en/es dictionaries load lazily in the app (src/i18n/dicts.app.ts); Node tests keep the
  // eager src/i18n/dicts.ts so makeT('en', …) stays synchronous there
  if (reactProfiling && moduleName === '../implementations/ReactFabric-prod') {
    return { type: 'sourceFile', filePath: path.join(path.dirname(context.originModulePath), '../implementations/ReactFabric-profiling.js') };
  }
  if (moduleName === './dicts.ts' && context.originModulePath === i18nCore) {
    return { type: 'sourceFile', filePath: i18nDictsApp };
  }
  return (upstreamResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
