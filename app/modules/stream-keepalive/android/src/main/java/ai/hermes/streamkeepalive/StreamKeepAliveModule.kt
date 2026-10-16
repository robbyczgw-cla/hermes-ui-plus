package ai.hermes.streamkeepalive

import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS API (src/background/keepAlive.ts): start / update / stop the dataSync foreground service that keeps the
 * process (network + JS) alive while a chat turn streams. The notification's "Stopp" action and the Android 15
 * dataSync time limit are reported back as events.
 */
class StreamKeepAliveModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StreamKeepAlive")

    // onStartFailed: the start was accepted (start() resolved true) but the service could not get into the
    // foreground or could not start its headless JS task; it has stopped again. JS resets its state on it.
    Events("onStopRequested", "onTimeout", "onStartFailed")

    OnCreate {
      StreamKeepAliveService.listener = { event -> sendEvent(event, emptyMap<String, Any?>()) }
    }

    OnDestroy {
      StreamKeepAliveService.listener = null
    }

    /**
     * Start (or update) the service. Must be called while the app is visible (Android 12+ forbids starting a
     * foreground service from the background); returns false when the system refused the intent. true only means
     * "intent accepted": the foreground promotion happens later in the service, a failure there is reported as
     * the onStartFailed event.
     */
    AsyncFunction("start") { title: String, text: String, stopLabel: String, channelName: String ->
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      val intent = Intent(ctx, StreamKeepAliveService::class.java)
        .setAction(StreamKeepAliveService.ACTION_START)
        .putExtra(StreamKeepAliveService.EXTRA_TITLE, title)
        .putExtra(StreamKeepAliveService.EXTRA_TEXT, text)
        .putExtra(StreamKeepAliveService.EXTRA_STOP_LABEL, stopLabel)
        .putExtra(StreamKeepAliveService.EXTRA_CHANNEL_NAME, channelName)
      try {
        StreamKeepAliveService.stopAfterStart = false
        StreamKeepAliveService.startPending = true
        ContextCompat.startForegroundService(ctx, intent)
        true
      } catch (e: Exception) {
        // ForegroundServiceStartNotAllowedException (API 31+, app in background / dataSync budget used up), SecurityException
        StreamKeepAliveService.startPending = false
        Log.w(TAG, "start refused: ${e.javaClass.simpleName}: ${e.message}")
        false
      }
    }

    AsyncFunction("update") { title: String, text: String ->
      if (!StreamKeepAliveService.running) return@AsyncFunction false
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      val intent = Intent(ctx, StreamKeepAliveService::class.java)
        .setAction(StreamKeepAliveService.ACTION_UPDATE)
        .putExtra(StreamKeepAliveService.EXTRA_TITLE, title)
        .putExtra(StreamKeepAliveService.EXTRA_TEXT, text)
      try {
        // the service is already in the foreground: a plain startService is allowed
        ctx.startService(intent)
        true
      } catch (e: Exception) {
        Log.w(TAG, "update failed: ${e.message}")
        false
      }
    }

    AsyncFunction("stop") {
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      // a start still on its way must reach startForeground first (else Android kills the app): stop right after it
      if (StreamKeepAliveService.startPending) {
        StreamKeepAliveService.stopAfterStart = true
        return@AsyncFunction true
      }
      ctx.stopService(Intent(ctx, StreamKeepAliveService::class.java))
    }

    Function("isRunning") { StreamKeepAliveService.running }

    Function("sdkInt") { Build.VERSION.SDK_INT }
  }

  companion object {
    const val TAG = "StreamKeepAlive"
  }
}
