# Dependency patches

Applied by `patch-package` (app `postinstall`, so every `npm ci` – build scripts, CI – installs patched sources).
A patch file is named `<package>+<version>.patch` and only valid for exactly that pinned version;
`scripts/dependency-patches.test.mjs` fails when a version changes, so each bump revisits its patch.

| Patch | Why | Remove when |
|---|---|---|
| `react-native-reanimated+4.5.1.patch` | Backport of [reanimated#10435](https://github.com/software-mansion/react-native-reanimated/pull/10435) (Android, RN ≥ 0.86): synchronous prop updates skip views that are no longer mounted. Without it every event dispatched during a draw pass (react-native-svg sends one per element on its first draw) re-applies Reanimated's whole props registry, and each entry of an unmounted view throws and logs a ~125-line stack on the UI thread ("synchronouslyUpdateUIProps failed for tag N … Unable to find SurfaceMountingManager"): hundreds per streamed answer. | Reanimated ≥ 4.7.1 (contains the fix). |
