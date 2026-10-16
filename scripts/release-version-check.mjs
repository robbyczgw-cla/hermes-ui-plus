#!/usr/bin/env node
// Release version gate for .github/workflows/release.yml.
//   release-version-check.mjs <ref_type> <ref_name>     (ref_type: branch | tag, as in github.ref_type)
// Every version field of the repository must agree (the same set the maintainers' release script checks), a tag must be
// v<version>, and CHANGELOG.md needs a "## <version> - <date>" section (a tag also needs a real date, not "unreleased").
// stdout: version=<version> (appended to $GITHUB_OUTPUT by the workflow); problems go to stderr, exit 1.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function readVersions(root = ROOT) {
  const json = (f) => JSON.parse(readFileSync(join(root, f), 'utf8'));
  const cargo = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(root, 'desktop/src-tauri/Cargo.toml'), 'utf8'))?.[1];
  return {
    'app/package.json': json('app/package.json').version,
    'app/app.json': json('app/app.json').expo.version,
    'bridge/package.json': json('bridge/package.json').version,
    'desktop/package.json': json('desktop/package.json').version,
    'desktop/src-tauri/tauri.conf.json': json('desktop/src-tauri/tauri.conf.json').version,
    'desktop/src-tauri/Cargo.toml': cargo,
  };
}

/** @returns {{version: string|undefined, problems: string[]}} */
export function check({ refType, refName, versions, changelog }) {
  const problems = [];
  const version = versions['bridge/package.json'];
  for (const [file, v] of Object.entries(versions)) {
    if (v !== version) problems.push(`${file} has version ${v}, bridge/package.json has ${version}`);
  }
  if (typeof version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/.test(version)) {
    problems.push(`bad version ${JSON.stringify(version)}`);
    return { version, problems };
  }
  if (refType === 'tag' && refName !== `v${version}`) problems.push(`tag ${refName} is not v${version}`);
  const heading = changelog.split('\n').find((l) => l.startsWith(`## ${version} - `));
  if (!heading) problems.push(`CHANGELOG.md has no "## ${version} - <date>" section`);
  else if (refType === 'tag' && /unreleased/i.test(heading)) problems.push(`CHANGELOG.md still says "${heading}"; date it before tagging`);
  return { version, problems };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [refType, refName] = process.argv.slice(2);
  if (!refType || !refName) {
    console.error('usage: release-version-check.mjs <branch|tag> <ref name>');
    process.exit(2);
  }
  const { version, problems } = check({
    refType, refName, versions: readVersions(), changelog: readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'),
  });
  if (problems.length) {
    for (const p of problems) console.error(`release-version-check: ${p}`);
    process.exit(1);
  }
  console.error(`release-version-check: ${version} (${refType} ${refName}) ok`);
  console.log(`version=${version}`);
}
