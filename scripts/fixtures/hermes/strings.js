// Source of strings.hbc, a real Hermes bytecode file for scripts/leak-guard.test.mjs (fake terms only). Regenerate:
//   app/node_modules/hermes-compiler/hermesc/linux64-bin/hermesc -emit-binary -out scripts/fixtures/hermes/strings.hbc scripts/fixtures/hermes/strings.js
// 'zorblax' lands glued to a neighbouring identifier in the string storage, 'Qüxel' is stored as UTF-16 and the
// long text (> 255 characters) is an overflow string table entry.
globalThis.plain = 'zorblax';
globalThis.unicode = 'Qüxel Fakename';
globalThis.overflow = 'lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum lorem ipsum zorbnik';
