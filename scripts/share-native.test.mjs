// Compile the installed, patched Android file-copy function with provider stubs; no Gradle or emulator.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MODULE = join(ROOT, 'app/node_modules/expo-share-intent/android/src/main/java/expo/modules/shareintent/ExpoShareIntentModule.kt');
function jar(group, name, version) {
  const dir = join(homedir(), '.gradle/caches/modules-2/files-2.1', group, name, version);
  if (!existsSync(dir)) return null;
  for (const hash of readdirSync(dir)) {
    const p = join(dir, hash, `${name}-${version}.jar`);
    if (existsSync(p)) return p;
  }
  return null;
}
const stdlib = jar('org.jetbrains.kotlin', 'kotlin-stdlib', '2.2.21');
const compiler = [
  ...['kotlin-compiler-embeddable', 'kotlin-stdlib', 'kotlin-script-runtime', 'kotlin-daemon-embeddable'].map((n) => jar('org.jetbrains.kotlin', n, '2.2.21')),
  jar('org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'),
  jar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.8.0'),
  jar('org.jetbrains', 'annotations', '23.0.0'),
];
const java = join(process.env.JAVA_HOME || join(homedir(), 'android/jdk-17'), 'bin/java');
const available = existsSync(java) && existsSync(MODULE) && compiler.every(Boolean);

test('Android shared files retain independent bytes without logging their display names', { skip: !available && 'local Kotlin/JDK test toolchain not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'hui-share-copy-test-'));
  try {
    const source = readFileSync(MODULE, 'utf8');
    const start = source.indexOf('    private fun getDataColumn');
    const end = source.indexOf('\n\n\n    /**', start);
    assert.ok(start > 0 && end > start, 'native copy function found');
    const kotlin = `
import java.io.File
import java.io.FileOutputStream
import java.io.ByteArrayInputStream
import java.util.Date
class Uri(val data:String) { val authority:String?="provider.test" }
class Cursor { fun moveToFirst()=true; fun getColumnIndexOrThrow(s:String)=0; fun getString(i:Int)="test-report.pdf"; fun close() {} }
class ContentResolver {
fun query(u:Uri,p:Array<String>?,s:String?,a:Array<String>?,o:String?):Cursor?=Cursor()
fun getType(u:Uri):String?="application/pdf"
fun openInputStream(u:Uri):ByteArrayInputStream?=ByteArrayInputStream(u.data.toByteArray())
}
class Context(val cacheDir:File) { val contentResolver=ContentResolver() }
class Activity(val contentResolver:ContentResolver)
object Log { val events=mutableListOf<String>(); fun i(t:String,m:String) { events.add(m) } }
class MimeTypeMap { companion object { fun getSingleton()=MimeTypeMap() }; fun getExtensionFromMimeType(m:String?)="pdf" }
class Harness(val context:Context) {
companion object { var instance:Harness?=null }
val currentActivity:Activity?=null
init { instance=this }
fun notifyError(s:String) {}
fun path(u:Uri)=getDataColumn(u,null,null)
${source.slice(start, end)}
}
fun main(args:Array<String>) {
val cache=File(args[0]); cache.mkdirs()
val h=Harness(Context(cache))
val first=File(h.path(Uri("first shared test file"))!!)
val second=File(h.path(Uri("second shared test file"))!!)
check(Log.events.none { it.contains("test-report.pdf") }) { "shared metadata leaked to logs" }
check(first.path!=second.path) { "shared files collided" }
check(first.readText()=="first shared test file") { "first shared file was overwritten" }
check(second.readText()=="second shared test file")
println("both files preserved")
}`;
    const fixture = join(dir, 'Test.kt');
    writeFileSync(fixture, kotlin);
    const classes = join(dir, 'classes');
    mkdirSync(classes);
    const compiled = spawnSync(java, ['-Xmx256m', '-cp', compiler.join(':'), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-classpath', stdlib, '-jvm-target', '17', '-d', classes, fixture], { encoding: 'utf8', timeout: 60000 });
    assert.equal(compiled.status, 0, compiled.stderr);
    const run = spawnSync(java, ['-Xmx128m', '-cp', `${classes}:${stdlib}`, 'TestKt', join(dir, 'cache')], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /both files preserved/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
