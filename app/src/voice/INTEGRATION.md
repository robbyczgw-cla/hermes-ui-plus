# Voice – integration guide

Owner: voice workstream (`app/src/voice/`). The module is self-contained, type-checked, linted and tested.
Wiring it in touches files owned by others: chat-shell (`chat/Composer.tsx`, `chat/MessageItem.tsx`,
`chat/ChatScreen.tsx`, `settings/SettingsScreen.tsx`) and `app.json`. Import everything from `../voice`.

```
app/src/voice/
  types.ts            VoiceConn, VoiceConfig, SttResult, VoiceSettings, VoiceError, VOICE_LIMITS          (pure)
  bridgeCore.ts       bridge contract: URLs, headers, parseVoiceConfig, parseSttResponse, error keys
                      (voice.errors.*, rendered with voiceErrorText), voiceConnFromProfile              (pure)
  speechText.ts       markdown + ```hui / ```hui-html → speakable prose (+ short summaries)               (pure)
  chunking.ts         German-aware sentence split, ≤ 3500-char chunks, progress                         (pure)
  queue.ts            sequential chunk playback with prefetch + guaranteed cleanup                      (pure)
  format.ts           timer label, metering → level, insertDictation, settings normalisation           (pure)
  bridge.ts           transcribe() (File.upload raw body), fetchTtsAudio() (→ cache file), fetchVoiceConfig()
  speaker.ts          global speaker store: speak/toggle/pause/resume/stop, useSpeaker(id)
  deviceTts.ts        expo-speech fallback (best installed voice for the active locale)
  useDictation.ts     recorder + permission + STT state machine, useDictationMeter()
  holdPress.ts        mic button tap / hold state machine: recording starts on touch-down       (pure)
  useAutoRead.ts      useAutoRead(messages, conn), useStopSpeakingOn(key)
  useVoiceConfig.ts   GET /bridge/voice/config as a hook (5 min cache)
  settingsStore.ts    AsyncStorage `hermes.voice.settings.v1`, useVoiceSettings()
  permissions.ts      ensureMicPermission() (a grant is remembered per process), openAppSettings()
  components/         MicButton, RecordingBar, DictationNotice, SpeakButton, VoiceSettingsSection, icons
  engine.ts           engine choice per direction, recognition error mapping                            (pure)
  apiCore.ts          own-key presets, request builders, response/error parsing                         (pure)
  apiKeys.ts          own keys in expo-secure-store (web: AsyncStorage)
  apiVoice.ts         transcribeWithApi() (multipart upload), fetchApiTtsAudio()
  deviceStt.ts        on-device recognition: iOS 26+ SpeechAnalyzer (modules/speech-analyzer), else
                      expo-speech-recognition (lazily required); backend choice engine.ts deviceSttBackend
  speechAnalyzerNative.ts  JS side of the local module modules/speech-analyzer (iOS only, optional)
  *.test.ts           node:test: `node --test src/voice/*.test.ts`
```

Engines per direction (settings `sttEngine` / `ttsEngine`: Automatisch | Gerät | UI-Bridge | Eigener API-Key;
resolved in `engine.ts`, tests in `engine.test.ts`):

| | Automatisch | Gerät | Eigener API-Key |
|---|---|---|---|
| STT | bridge (if it has STT) → device → own key | `deviceStt.ts`: iOS 26+ SpeechAnalyzer/SpeechTranscriber (local module, long-form, on-device; model download on first use shows "Sprachmodell wird geladen … x %"); otherwise expo-speech-recognition (Android SpeechRecognizer, iOS < 26 SFSpeechRecognizer, on-device preferred) / Web Speech API; live text in the RecordingBar | `apiVoice.ts`: OpenAI-compatible `/audio/transcriptions` (Groq, OpenAI, custom) |
| TTS | bridge (if it has TTS) → device | expo-speech / speechSynthesis, voice list filtered by app language (`deviceVoice`), Premium/Enhanced first (iOS: exact quality from modules/speech-analyzer `getVoices()`, novelty voices hidden) | OpenAI-compatible `/audio/speech` or Deepgram `/v1/speak` |

Own keys live in the secure store (`apiKeys.ts`, web: localStorage), never in settings or logs. Request builders
are pure (`apiCore.ts`, `apiCore.test.ts`). The bridge path is unchanged. The bridge connection (still passed in
as before, `null` = no bridge) is obtained once per profile:
```ts
import { voiceConnFromProfile } from '../voice';
const voiceConn = useMemo(() => voiceConnFromProfile(profile), [profile.kind, profile.baseUrl, profile.apiKey, profile.bridge]);
// → { baseUrl, apiKey } or null (Claude direct, Hermes direct, no bridge)
```

---

## 0. `app.json` (owner: chat-shell / lead) – required before a native build

**a) Unblock the microphone.** `expo-image-picker` is configured with `"microphonePermission": false`.
That option does not only skip the permission: its plugin calls `withBlockedPermissions(['android.permission.RECORD_AUDIO'])`,
which writes `tools:node="remove"` for RECORD_AUDIO into the manifest (verified in
`node_modules/expo-image-picker/plugin/build/withImagePicker.js`). Dictation would then fail on Android
forever ("Mikrofon-Zugriff ist deaktiviert"). Replace it with the same German text as below (or delete the key):
```jsonc
["expo-image-picker", {
  "photosPermission": "Hermes braucht Zugriff auf deine Fotos, um Bilder an Nachrichten anzuhängen.",
  "cameraPermission": "Hermes braucht die Kamera, um Fotos für deine Nachrichten aufzunehmen.",
  "microphonePermission": "Hermes braucht das Mikrofon, damit du Nachrichten diktieren kannst. Die Aufnahme wird nur zur Spracherkennung an deine UI-Bridge gesendet."
}]
```

**b) Configure the expo-audio plugin** (currently the bare string `"expo-audio"` → English default text):
```jsonc
["expo-audio", {
  "microphonePermission": "Hermes braucht das Mikrofon, damit du Nachrichten diktieren kannst. Die Aufnahme wird nur zur Spracherkennung an deine UI-Bridge gesendet.",
  "recordAudioAndroid": true,            // adds android.permission.RECORD_AUDIO (default true, keep it)
  "enableBackgroundPlayback": false      // default true adds FOREGROUND_SERVICE_MEDIA_PLAYBACK + UIBackgroundModes audio;
                                         // the speaker pauses in the background, so we don't need it (Play-Store declaration)
}]
```
(`enableBackgroundRecording` stays false: dictation stops when the app goes to the background.)
Plugin options verified in `node_modules/expo-audio/plugin/build/withAudio.js` (SDK 57, expo-audio 57.0.5).
Needs a new dev build / APK. Expo Go also works for testing.

## 1. Composer (owner: chat-shell, `chat/Composer.tsx`)

The hook must live in a component that stays mounted while recording (the composer).
```tsx
import { DictationNotice, MicButton, RecordingBar, insertDictation, useDictation, voiceConnFromProfile } from '../voice';

const voiceConn = useMemo(() => voiceConnFromProfile(profile), [profile.kind, profile.baseUrl, profile.apiKey, profile.bridge]);
const selection = useRef<{ start: number; end: number } | undefined>(undefined);
const dictation = useDictation({
  conn: voiceConn,
  onText: (dictated) => {
    // insert at the caret (or append) – never sends by itself
    setText((cur) => insertDictation(cur, dictated, selection.current).text);
    selection.current = undefined;
  },
});

<TextInput … onSelectionChange={(e) => (selection.current = e.nativeEvent.selection)} />
```
Layout inside the input row (ChatGPT style). The RecordingBar replaces the ＋ button and the input. The
MicButton stays mounted at the same spot during the whole recording (it becomes the ✓ "Fertig" button).
This matters for hold-to-talk because the finger is on it:
```tsx
<View style={styles.inputRow}>
  {dictation.active ? (
    <RecordingBar dictation={dictation} />
  ) : (
    <>
      <AttachmentButton … />
      <TextInput … />
    </>
  )}
  {!streaming && (dictation.active || !hasContent) ? (
    <MicButton dictation={dictation} />          // 36 px, same size as the send button
  ) : (
    <SendOrStopButton … />
  )}
</View>
<DictationNotice dictation={dictation} />          // next to draft.error; tap to dismiss
```
Alternative: show the MicButton permanently to the left of the send button and hide the send button while
`dictation.active`. Do not unmount the MicButton while `dictation.active`.

- `useDictation` picks the engine itself (`dictation.engine`, `dictation.unavailable`). With the device engine the
  interim transcript replaces the waveform in the RecordingBar; the final text arrives via `onText` when the
  engine ends (pause, ✓, release, 120 s).
- No engine available: the MicButton stays visible but dimmed. A tap shows "Spracheingabe braucht die UI-Bridge. Tipp: …
  Mikrofon deiner Tastatur …" in `DictationNotice`. To hide it instead, use `{dictation.available && <MicButton/>}`.
- Optional auto-send (reserved flag, default off): in `onText`, `if (getVoiceSettings().autoSend) onSend(newText, …)`.
- Behaviour: tap = start, tap ✓ = stop + transcribe. Hold ≥ 280 ms = hold-to-talk; release = stop + transcribe;
  slide ≥ 90 px left = discard. The × in the RecordingBar = discard (or abort the upload). Hard limit 120 s
  (the timer shows "noch 15 s" near the end, then it stops and transcribes automatically). Recordings
  under 0.6 s → "Zu kurz …". On network, timeout, 5xx or 429 errors the recording is kept, and DictationNotice
  shows "Erneut senden". Starting a recording stops any "Vorlesen".
- Permission: the first tap asks. "Don't ask again" / blocked → message + "Einstellungen öffnen"
  (`Linking.openSettings`). If the system dialog interrupted a hold gesture, nothing is recorded and a hint is shown.

## 2. Assistant action row (owner: chat-shell, `chat/MessageItem.tsx`)

```tsx
import { SpeakButton } from '../voice';

<View style={styles.actionsRow}>
  <IconButton icon="copy" … />
  <IconButton icon="share" … />
  <SpeakButton message={message} conn={voiceConn} onError={(m) => toast(m)} />
  {isLast ? <IconButton icon="retry" … /> : null}
</View>
```
`voiceConn` comes from the profile (pass it down from ChatScreen, like `profile`). Same metrics as
IconButton (17 px icon, padding 6). Tap: play → pause → resume. While active, a stop button appears and a
progress ring is drawn. Starting another message stops the current one. Without bridge it uses the
on-device voice (expo-speech, German if installed).

## 3. Chat screen (owner: chat-shell, `chat/ChatScreen.tsx` / session components)

```tsx
import { stopSpeaking, useAutoRead, useStopSpeakingOn } from '../voice';

useAutoRead(messages, voiceConn);        // honours the "Antworten automatisch vorlesen" setting;
                                         // only replies that finish streaming while the chat is open
useStopSpeakingOn(conversationId);       // stops on conversation switch + unmount
// in "Neuer Chat" / newSession(): stopSpeaking();
```
`messages` only needs `{id, role, text, status}` (structural, works with Hermes and Claude ChatMessage).

## 4. Settings (owner: chat-shell, `settings/SettingsScreen.tsx`)

```tsx
import { VoiceSettingsSection, voiceConnFromProfile } from '../voice';
<VoiceSettingsSection conn={voiceConnFromProfile(activeProfile)} />
```
It renders its own section titles ("SPRACHAUSGABE", "SPRACHEINGABE") and groups, in the same style as
SettingsScreen (put it inside the ScrollView, which has `gap: 8`):
- the voice list from `/bridge/voice/config` (German voices first, 6 visible + "Alle N Stimmen anzeigen"),
  "Probehören" per voice, the selection saved as `ttsVoice`. Without bridge or without bridge TTS: a
  "Gerätestimme" row with a preview.
- speed 0,75× … 2× (on the device: expo-audio `setPlaybackRate(rate, 'high')`, pitch-corrected; on-device
  voice: `rate`). It applies immediately to the running playback.
- the switch "Antworten automatisch vorlesen" (`autoRead`).
- the STT language Automatisch / Deutsch / English (`X-Language` header, omitted for automatic).
Settings are global (not per profile): AsyncStorage `hermes.voice.settings.v1`. `useVoiceSettings()` /
`getVoiceSettings()` / `updateVoiceSettings(patch)`.

## 5. Bridge contract (owner: bridge voice agent) – what the app sends

- `GET {origin}/bridge/voice/config`, `Authorization: Bearer <token>`. The parser is tolerant: missing
  `stt` or `tts` → feature shown as "nicht eingerichtet"; voices may also be plain strings; an unknown
  `defaultVoice` → the first voice.
- `POST {origin}/bridge/stt`, `Content-Type: audio/mp4` (Android + iOS: `.m4a`, AAC-LC, mono, 44.1 kHz,
  64 kbit/s ≈ 0.5 MB/min) or `audio/webm` (web/Chrome; codec parameters are stripped). Optional
  `X-Language: de|en`. The body is the raw file (expo-file-system `File.upload`, `BINARY_CONTENT`). Max 120 s ≈ 1 MB.
  The response `text` is trimmed. An empty text or a Whisper artefact ("[Musik]", "(Stille)") → "Keine Sprache erkannt".
  Recognised error codes/types (`error.code`/`error.type`): `no_speech|empty_audio|no_audio|silence`,
  `*not_configured*|disabled|no_provider` (or HTTP 501) → "… ist auf der UI-Bridge nicht eingerichtet".
- `POST {origin}/bridge/tts` JSON `{text, voice?, format:'mp3'}`, `Accept: audio/mpeg`, text ≤ 3500 chars
  per call (limit 4000). The first chunk is ≤ 400 chars (whole sentences), so audio starts sooner. One chunk is
  prefetched while the previous one plays. If the bridge answers 404/405/501/not_configured, the app falls back
  to the device voice for 10 minutes.
- Why it downloads instead of streaming: expo-audio sends custom headers for remote sources
  (`{uri, headers}`), but only as a GET. The contract is POST+JSON, so each chunk is fetched with expo/fetch,
  written to `<cache>/voice-tts/*.mp3`, played, and deleted. To get real streaming later, the bridge could
  offer `GET /bridge/tts/<one-time-id>.mp3` (id from a POST). The player would then take `{uri, headers}` directly.
- Web dev: CORS preflight must allow `Authorization, Content-Type, X-Language`.

## 6. Speech text rules (speechText.ts)

Markdown is reduced to prose. Headings and list items become sentences. Links → link text, bare URLs →
host name. Emoji, HTML, inline code markers and emphasis are removed. Blocks get a short summary:
`table` "Hier ist eine Tabelle mit 8 Zeilen.", `chart` "Hier ist ein Diagramm: <Titel>.", `stats` (≤ 4)
"Umsatz: 1,2 Mio €, Kunden: 830.", list/steps/timeline/compare/form/image/progress → one sentence;
`text`/`callout`/`card` children are read; `buttons`/`suggestions` are skipped; `hui-html` → "Hier ist eine
interaktive Ansicht."; other code → "Hier ist ein Codeblock."; a markdown table → number of rows. Unfinished or
invalid hui JSON is skipped (raw JSON is never read aloud). `speak({…, plain: true})` skips all of this.
Otherwise `speak` takes the active `t` (useT) and `locale` (useLocale), so summaries are spoken in the app language.

## 7. Not verified on a device (no device in this workstream)

Type-checked, linted and unit-tested only. Please check in the first dev build:
1. Android + iOS: permission dialog text, the blocked → settings path, and RECORD_AUDIO present in the merged manifest after 0a.
2. Recording: `.m4a` arrives at the bridge as `audio/mp4` and is transcribed. Check that metering moves the waveform (Android
   uses `MediaRecorder.getMaxAmplitude`).
3. Hold-to-talk with RNGH `Gesture.Manual` (activate on touch-down, slide to cancel). Check TalkBack/VoiceOver double-tap (handled by
   `accessibilityActions: activate`, so there is no double toggle).
4. Playback: `player.replace({uri: file})` + `play()` per chunk, `didJustFinish` → next chunk, no gap or skipped
   chunk, pause/resume, speed change. Audio mode switches back after recording (`allowsRecording: false`) so
   iOS plays through the loudspeaker, not the earpiece.
5. expo-speech fallback: German voice found. Android has no `Speech.pause` → pause restarts the current ≤ 400-char chunk.
6. Web (`expo start --web`): MediaRecorder webm upload, blob-URL playback.
7. Device STT (needs a new APK / iOS build: native module `expo-speech-recognition` 57.1.1): permission dialog
   (iOS asks for microphone + speech recognition), live text, auto end after a pause, the on-device model on
   Android 13+ (`getSupportedLocales().installedLocales`, otherwise network recognition), iOS audio route back to
   the loudspeaker after dictation. An older build without the module hides "Gerät" (`deviceSttAvailable()` false).
8. Own keys: Groq / OpenAI transcription with `.m4a` multipart upload, OpenAI `/audio/speech` and Deepgram mp3
   playback. On web the provider must allow browser (CORS) requests; this was not checked for Groq, OpenAI or
   Deepgram.

## iOS 26+: SpeechAnalyzer (local module `modules/speech-analyzer`)

Swift, Expo Modules API, iOS pod `HuiSpeechAnalyzer` (deployment target 16.4; all SpeechAnalyzer code behind
`#available(iOS 26, *)`). JS module name `HuiSpeechAnalyzer`, required optionally (`speechAnalyzerNative.ts`), so
builds without it keep working. API: `isAvailable()`, `supportedLocales()`, `modelStatus(locale)`,
`ensureModel(locale)` (AssetInventory download, `modelProgress` events), `start({ locale, partial })`, `stop()`
(finalize, then `end`), `cancel()`, `getPermissionsAsync()` / `requestPermissionsAsync()` (mic + speech),
`getVoices()` (AVSpeechSynthesisVoice with exact quality default/enhanced/premium + novelty/personal flags).
Events: `partial` (volatile), `final` (finalized segment), `error` (expo-speech-recognition style codes +
`model-not-installed` / `model-download-failed`), `end` (once), `level` (0..1), `modelProgress` (0..1).
Audio: AVAudioEngine tap → AVAudioConverter (analyzer format) → SpeechAnalyzer; session playAndRecord/spokenAudio
while listening, then back to playback (speaker route for TTS). Interruptions / route changes finalize.
Fallback to expo-speech-recognition: iOS < 26, hardware without SpeechTranscriber, language not supported, model
download failed. Unlike SFSpeechRecognizer it does not stop after a pause: it listens until ✓ / release / 120 s.
