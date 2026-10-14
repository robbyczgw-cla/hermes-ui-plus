// Local Expo module "HuiSpeechAnalyzer": on-device dictation with Apple's SpeechAnalyzer + SpeechTranscriber
// (iOS 26+, Speech framework). JS side: app/src/voice/speechAnalyzerNative.ts, used by app/src/voice/deviceStt.ts.
//
// Flow: ensureModel(locale) (AssetInventory download, "modelProgress" events) → start({locale, partial}) →
// AVAudioEngine input tap → AVAudioConverter (analyzer format) → AsyncStream<AnalyzerInput> → SpeechAnalyzer.
// transcriber.results streams volatile ("partial") and finalized ("final") text. stop() finalizes through the
// end of the input, then "end" carries the whole transcript; cancel() drops everything ("end" with cancelled).
// The audio session is switched to playAndRecord while listening and set back to playback afterwards, so TTS
// and other audio go to the speaker again (playAndRecord would route them to the receiver).
//
// On iOS < 26 (and on hardware without SpeechTranscriber support) isAvailable() is false and the app keeps
// using expo-speech-recognition (SFSpeechRecognizer). getVoices() works on every iOS version.

import AVFoundation
import ExpoModulesCore
import Speech

struct HuiAnalyzerStartOptions: Record {
  @Field var locale: String = "de-DE"
  @Field var partial: Bool = true
}

/// JS error.code values match the expo-speech-recognition codes mapped in app/src/voice/engine.ts.
func huiSpeechError(_ code: String, _ message: String) -> Exception {
  return Exception(name: "SpeechAnalyzerError", description: message, code: code)
}

public final class HuiSpeechAnalyzerModule: Module {
  private let lock = NSLock()
  /// AnalyzerSession (iOS 26+); AnyObject so the stored property needs no availability annotation
  private var current: AnyObject?

  private func setCurrent(_ s: AnyObject?) {
    lock.lock()
    current = s
    lock.unlock()
  }

  private func getCurrent() -> AnyObject? {
    lock.lock()
    defer { lock.unlock() }
    return current
  }

  public func definition() -> ModuleDefinition {
    Name("HuiSpeechAnalyzer")

    Events("partial", "final", "error", "end", "level", "modelProgress")

    Function("isAvailable") { () -> Bool in
      if #available(iOS 26.0, *) {
        return SpeechTranscriber.isAvailable
      }
      return false
    }

    AsyncFunction("supportedLocales") { () async -> [String: [String]] in
      if #available(iOS 26.0, *) {
        guard SpeechTranscriber.isAvailable else { return ["supported": [], "installed": []] }
        let supported = await SpeechTranscriber.supportedLocales.map { $0.identifier(.bcp47) }
        let installed = await SpeechTranscriber.installedLocales.map { $0.identifier(.bcp47) }
        return ["supported": supported, "installed": installed]
      }
      return ["supported": [], "installed": []]
    }

    /// 'installed' | 'supported' (download needed) | 'downloading' | 'unsupported' | 'unavailable' (iOS < 26)
    AsyncFunction("modelStatus") { (localeId: String) async -> [String: Any] in
      if #available(iOS 26.0, *) {
        return await HuiAnalyzerModels.status(localeId)
      }
      return ["status": "unavailable"]
    }

    /// Downloads the transcriber model for `locale` if needed ("modelProgress" events 0…1).
    /// → { status: 'installed' | 'downloaded' | 'unsupported', locale }
    AsyncFunction("ensureModel") { (localeId: String) async throws -> [String: Any] in
      if #available(iOS 26.0, *) {
        return try await HuiAnalyzerModels.ensure(localeId) { [weak self] fraction in
          self?.sendEvent("modelProgress", ["locale": localeId, "progress": fraction])
        }
      }
      throw huiSpeechError("service-not-allowed", "SpeechAnalyzer needs iOS 26")
    }

    AsyncFunction("getPermissionsAsync") { () -> [String: Any] in
      return HuiSpeechPermissions.current()
    }

    AsyncFunction("requestPermissionsAsync") { () async -> [String: Any] in
      return await HuiSpeechPermissions.request()
    }

    AsyncFunction("start") { (options: HuiAnalyzerStartOptions) async throws in
      guard #available(iOS 26.0, *) else {
        throw huiSpeechError("service-not-allowed", "SpeechAnalyzer needs iOS 26")
      }
      if let busy = self.getCurrent() as? HuiAnalyzerSession, !busy.isEnded {
        throw huiSpeechError("busy", "A recognition session is already running")
      }
      let perms = HuiSpeechPermissions.current()
      if perms["granted"] as? Bool != true {
        throw huiSpeechError("not-allowed", "Microphone or speech recognition permission missing")
      }
      let session = HuiAnalyzerSession(
        emit: { [weak self] name, body in self?.sendEvent(name, body) },
        onFinished: { [weak self] s in
          guard let self else { return }
          self.lock.lock()
          if self.current === s { self.current = nil }
          self.lock.unlock()
        }
      )
      self.setCurrent(session)
      do {
        try await session.start(localeId: options.locale, partial: options.partial)
      } catch {
        self.setCurrent(nil)
        throw error
      }
    }

    AsyncFunction("stop") { () async in
      if #available(iOS 26.0, *), let s = self.getCurrent() as? HuiAnalyzerSession {
        await s.stop()
      }
    }

    AsyncFunction("cancel") { () async in
      if #available(iOS 26.0, *), let s = self.getCurrent() as? HuiAnalyzerSession {
        await s.cancel()
      }
    }

    /// Installed AVSpeechSynthesis voices with the exact quality (expo-speech reports premium as "Default").
    Function("getVoices") { () -> [[String: Any]] in
      return AVSpeechSynthesisVoice.speechVoices().map { v in
        var quality = "default"
        switch v.quality {
        case .enhanced: quality = "enhanced"
        case .premium: quality = "premium"
        default: quality = "default"
        }
        var novelty = false
        var personal = false
        if #available(iOS 17.0, *) {
          novelty = v.voiceTraits.contains(.isNoveltyVoice)
          personal = v.voiceTraits.contains(.isPersonalVoice)
        }
        return [
          "identifier": v.identifier,
          "name": v.name,
          "language": v.language,
          "quality": quality,
          "novelty": novelty,
          "personal": personal,
        ]
      }
    }

    OnDestroy {
      if #available(iOS 26.0, *), let s = self.getCurrent() as? HuiAnalyzerSession {
        Task { await s.cancel() }
      }
    }
  }
}

// MARK: - permissions (microphone + speech recognition)

enum HuiSpeechPermissions {
  /// expo-style permission response: { granted, canAskAgain, status, mic, speech }
  static func current() -> [String: Any] {
    let mic = micStatus()
    let speech: String
    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized: speech = "granted"
    case .notDetermined: speech = "undetermined"
    default: speech = "denied"
    }
    let granted = mic == "granted" && speech == "granted"
    let canAskAgain = mic != "denied" && speech != "denied"
    return [
      "granted": granted,
      "canAskAgain": canAskAgain,
      "status": granted ? "granted" : (canAskAgain ? "undetermined" : "denied"),
      "expires": "never",
      "mic": mic,
      "speech": speech,
    ]
  }

  static func request() async -> [String: Any] {
    if micStatus() == "undetermined" {
      if #available(iOS 17.0, *) {
        _ = await AVAudioApplication.requestRecordPermission()
      } else {
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
          AVAudioSession.sharedInstance().requestRecordPermission { _ in c.resume() }
        }
      }
    }
    if SFSpeechRecognizer.authorizationStatus() == .notDetermined {
      await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
        SFSpeechRecognizer.requestAuthorization { _ in c.resume() }
      }
    }
    return current()
  }

  private static func micStatus() -> String {
    if #available(iOS 17.0, *) {
      switch AVAudioApplication.shared.recordPermission {
      case .granted: return "granted"
      case .undetermined: return "undetermined"
      default: return "denied"
      }
    }
    switch AVAudioSession.sharedInstance().recordPermission {
    case .granted: return "granted"
    case .undetermined: return "undetermined"
    default: return "denied"
    }
  }
}

// MARK: - model assets (AssetInventory)

@available(iOS 26.0, *)
enum HuiAnalyzerModels {
  static func transcriber(for locale: Locale, partial: Bool) -> SpeechTranscriber {
    return SpeechTranscriber(
      locale: locale,
      transcriptionOptions: [],
      reportingOptions: partial ? [.volatileResults] : [],
      attributeOptions: []
    )
  }

  static func status(_ localeId: String) async -> [String: Any] {
    guard SpeechTranscriber.isAvailable else { return ["status": "unavailable"] }
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeId)) else {
      return ["status": "unsupported"]
    }
    let st = await AssetInventory.status(forModules: [transcriber(for: locale, partial: true)])
    let name: String
    if st == .installed {
      name = "installed"
    } else if st == .downloading {
      name = "downloading"
    } else if st == .supported {
      name = "supported"
    } else {
      name = "unsupported"
    }
    return ["status": name, "locale": locale.identifier(.bcp47)]
  }

  static func ensure(_ localeId: String, progress: @escaping @Sendable (Double) -> Void) async throws -> [String: Any] {
    guard SpeechTranscriber.isAvailable else {
      throw huiSpeechError("service-not-allowed", "SpeechTranscriber is not available on this device")
    }
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeId)) else {
      return ["status": "unsupported"]
    }
    let bcp = locale.identifier(.bcp47)
    let module = transcriber(for: locale, partial: true)
    let st = await AssetInventory.status(forModules: [module])
    if st == .installed { return ["status": "installed", "locale": bcp] }
    if st == .unsupported { return ["status": "unsupported", "locale": bcp] }
    do {
      if let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
        let p = request.progress
        progress(0)
        let poll = Task {
          while !Task.isCancelled {
            progress(p.fractionCompleted)
            try? await Task.sleep(nanoseconds: 250_000_000)
          }
        }
        defer { poll.cancel() }
        try await request.downloadAndInstall()
      }
    } catch {
      throw huiSpeechError("model-download-failed", "Speech model download failed: \(error.localizedDescription)")
    }
    progress(1)
    return ["status": "downloaded", "locale": bcp]
  }
}

// MARK: - one recognition session

@available(iOS 26.0, *)
final class HuiAnalyzerSession: @unchecked Sendable {
  typealias Emit = (String, [String: Any?]) -> Void

  private let emit: Emit
  private let onFinished: (HuiAnalyzerSession) -> Void
  private let engine = AVAudioEngine()
  private let lock = NSLock()

  private var analyzer: SpeechAnalyzer?
  private var input: AsyncStream<AnalyzerInput>.Continuation?
  private var resultsTask: Task<Void, Never>?
  private var converter: AVAudioConverter?
  private var targetFormat: AVAudioFormat?
  private var tapInstalled = false
  private var audioConfigured = false
  private var savedCategory: AVAudioSession.Category?
  private var savedOptions: AVAudioSession.CategoryOptions = []
  private var observers: [NSObjectProtocol] = []

  private var finalized = ""
  private var volatile = ""
  private var lastLevelAt: CFAbsoluteTime = 0
  private var ended = false
  private var stopping = false
  private var cancelled = false
  private var pendingError: (code: String, message: String)?

  init(emit: @escaping Emit, onFinished: @escaping (HuiAnalyzerSession) -> Void) {
    self.emit = emit
    self.onFinished = onFinished
  }

  var isEnded: Bool {
    lock.lock()
    defer { lock.unlock() }
    return ended
  }

  // MARK: start

  func start(localeId: String, partial: Bool) async throws {
    guard SpeechTranscriber.isAvailable else {
      throw huiSpeechError("service-not-allowed", "SpeechTranscriber is not available on this device")
    }
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeId)) else {
      throw huiSpeechError("language-not-supported", "Locale \(localeId) is not supported by SpeechTranscriber")
    }
    let transcriber = HuiAnalyzerModels.transcriber(for: locale, partial: partial)
    let st = await AssetInventory.status(forModules: [transcriber])
    guard st == .installed else {
      throw huiSpeechError("model-not-installed", "The speech model for \(localeId) is not installed (call ensureModel)")
    }
    guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
      throw huiSpeechError("audio-capture", "No audio format compatible with SpeechTranscriber")
    }
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    do {
      try await analyzer.prepareToAnalyze(in: format)
    } catch {
      throw huiSpeechError("busy", "SpeechAnalyzer could not prepare: \(error.localizedDescription)")
    }
    self.analyzer = analyzer
    self.targetFormat = format

    do {
      try configureAudioSession()
      let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
      input = continuation
      resultsTask = Task { [weak self] in
        await self?.consume(transcriber)
      }
      try await analyzer.start(inputSequence: stream)
      try startEngine()
      observeInterruptions()
    } catch {
      let code = (error as? Exception)?.code ?? "audio-capture"
      cancelled = true
      teardownAudio()
      input?.finish()
      await analyzer.cancelAndFinishNow()
      resultsTask?.cancel()
      markEnded()
      throw huiSpeechError(code == "busy" ? "busy" : "audio-capture", "Audio input could not start: \(error.localizedDescription)")
    }
  }

  // MARK: stop / cancel

  /// Stop listening and finalize: the remaining volatile text becomes final, then "end".
  func stop() async {
    lock.lock()
    if stopping || ended {
      lock.unlock()
      return
    }
    stopping = true
    lock.unlock()
    stopEngine()
    input?.finish()
    do {
      try await analyzer?.finalizeAndFinishThroughEndOfInput()
    } catch {
      setError("unknown", "Finalizing failed: \(error.localizedDescription)")
    }
    await resultsTask?.value
    finish()
  }

  /// Discard: no more results, "end" with cancelled: true.
  func cancel() async {
    lock.lock()
    if ended {
      lock.unlock()
      return
    }
    cancelled = true
    lock.unlock()
    stopEngine()
    input?.finish()
    await analyzer?.cancelAndFinishNow()
    resultsTask?.cancel()
    finish()
  }

  // MARK: results

  private func consume(_ transcriber: SpeechTranscriber) async {
    do {
      for try await result in transcriber.results {
        let text = String(result.text.characters)
        lock.lock()
        if cancelled {
          lock.unlock()
          break
        }
        if result.isFinal {
          finalized = Self.join(finalized, text)
          volatile = ""
        } else {
          volatile = text
        }
        let transcript = Self.join(finalized, volatile)
        let fin = finalized
        let isFinal = result.isFinal
        lock.unlock()
        if isFinal {
          emit("final", ["text": text.trimmingCharacters(in: .whitespacesAndNewlines), "transcript": fin])
        } else {
          emit("partial", ["text": text.trimmingCharacters(in: .whitespacesAndNewlines), "transcript": transcript])
        }
      }
    } catch {
      if !isCancelled() {
        setError("unknown", "Transcription failed: \(error.localizedDescription)")
      }
    }
    // the sequence ended by itself (e.g. the analyzer finished after an audio problem) → end the session
    if !isStopping() { finish() }
  }

  private static func join(_ a: String, _ b: String) -> String {
    let x = a.trimmingCharacters(in: .whitespacesAndNewlines)
    let y = b.trimmingCharacters(in: .whitespacesAndNewlines)
    if x.isEmpty { return y }
    if y.isEmpty { return x }
    return "\(x) \(y)"
  }

  private func isCancelled() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return cancelled
  }

  private func isStopping() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return stopping
  }

  private func setError(_ code: String, _ message: String) {
    lock.lock()
    if pendingError == nil { pendingError = (code, message) }
    lock.unlock()
  }

  private func markEnded() {
    lock.lock()
    ended = true
    lock.unlock()
    onFinished(self)
  }

  /// Exactly once: release audio, emit "error" (if any) and "end".
  private func finish() {
    lock.lock()
    if ended {
      lock.unlock()
      return
    }
    ended = true
    let wasCancelled = cancelled
    let transcript = wasCancelled ? "" : Self.join(finalized, volatile)
    let err = wasCancelled ? nil : pendingError
    lock.unlock()
    teardownAudio()
    if let err {
      emit("error", ["error": err.code, "message": err.message])
    }
    emit("end", ["transcript": transcript, "cancelled": wasCancelled])
    onFinished(self)
  }

  // MARK: audio

  private func configureAudioSession() throws {
    let s = AVAudioSession.sharedInstance()
    savedCategory = s.category
    savedOptions = s.categoryOptions
    do {
      try s.setCategory(.playAndRecord, mode: .spokenAudio, options: [.duckOthers, .defaultToSpeaker, .allowBluetoothHFP])
      try s.setActive(true, options: .notifyOthersOnDeactivation)
      audioConfigured = true
    } catch {
      throw huiSpeechError("busy", "Audio session unavailable: \(error.localizedDescription)")
    }
  }

  private func startEngine() throws {
    let node = engine.inputNode
    let inFormat = node.outputFormat(forBus: 0)
    guard inFormat.sampleRate > 0, inFormat.channelCount > 0 else {
      throw huiSpeechError("audio-capture", "No microphone input")
    }
    node.installTap(onBus: 0, bufferSize: 4096, format: inFormat) { [weak self] buffer, _ in
      self?.handle(buffer)
    }
    tapInstalled = true
    engine.prepare()
    try engine.start()
  }

  private func stopEngine() {
    if engine.isRunning { engine.stop() }
    if tapInstalled {
      engine.inputNode.removeTap(onBus: 0)
      tapInstalled = false
    }
  }

  private func teardownAudio() {
    stopEngine()
    for o in observers { NotificationCenter.default.removeObserver(o) }
    observers.removeAll()
    guard audioConfigured else { return }
    audioConfigured = false
    let s = AVAudioSession.sharedInstance()
    try? s.setActive(false, options: .notifyOthersOnDeactivation)
    // back to playback (speaker route) so TTS / the audio player are not left on the receiver of playAndRecord
    let keepOptions = savedCategory == .playback ? savedOptions : []
    try? s.setCategory(.playback, mode: .default, options: keepOptions)
  }

  private func observeInterruptions() {
    let nc = NotificationCenter.default
    observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { [weak self] note in
      guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
      Task { await self?.stop() }
    })
    // input route / format changed (e.g. headset unplugged): the engine stopped → finalize what we have
    observers.append(nc.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { [weak self] _ in
      Task { await self?.stop() }
    })
  }

  private func handle(_ buffer: AVAudioPCMBuffer) {
    emitLevel(buffer)
    guard let input, let target = targetFormat else { return }
    if let converted = convert(buffer, to: target) {
      input.yield(AnalyzerInput(buffer: converted))
    }
  }

  private func convert(_ buffer: AVAudioPCMBuffer, to target: AVAudioFormat) -> AVAudioPCMBuffer? {
    if buffer.format == target { return buffer }
    if converter == nil || converter?.inputFormat != buffer.format {
      converter = AVAudioConverter(from: buffer.format, to: target)
      converter?.primeMethod = .none
    }
    guard let converter else { return nil }
    let ratio = target.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 16
    guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return nil }
    var consumed = false
    var error: NSError?
    let status = converter.convert(to: out, error: &error) { _, inputStatus in
      if consumed {
        inputStatus.pointee = .noDataNow
        return nil
      }
      consumed = true
      inputStatus.pointee = .haveData
      return buffer
    }
    if status == .error || out.frameLength == 0 { return nil }
    return out
  }

  /// RMS of the first channel → 0…1 (−50 dBFS … 0 dBFS), at most every 100 ms.
  private func emitLevel(_ buffer: AVAudioPCMBuffer) {
    let now = CFAbsoluteTimeGetCurrent()
    guard now - lastLevelAt >= 0.1, let data = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
    lastLevelAt = now
    let n = Int(buffer.frameLength)
    var sum: Float = 0
    for i in 0..<n { sum += data[i] * data[i] }
    let rms = sqrt(sum / Float(n))
    let db = rms > 0 ? 20 * log10(rms) : -160
    let level = max(0, min(1, (db + 50) / 50))
    emit("level", ["level": Double(level)])
  }
}
