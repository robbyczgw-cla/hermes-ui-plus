// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const i18nCore = path.join(__dirname, 'src/i18n/core.ts');
const i18nDictsApp = path.join(__dirname, 'src/i18n/dicts.app.ts');
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // i18n: en/es dictionaries load lazily in the app (src/i18n/dicts.app.ts); Node tests keep the
  // eager src/i18n/dicts.ts so makeT('en', …) stays synchronous there
  if (moduleName === './dicts.ts' && context.originModulePath === i18nCore) {
    return { type: 'sourceFile', filePath: i18nDictsApp };
  }
  return (upstreamResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
