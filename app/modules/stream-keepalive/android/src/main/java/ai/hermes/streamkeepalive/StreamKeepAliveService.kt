package ai.hermes.streamkeepalive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Foreground service (type dataSync: "fetch data / transfer data between a device and the cloud") that runs only
 * while a chat answer streams. It does no work itself: being a foreground service keeps the process at foreground
 * priority, so the OS does not cut the app's sockets when it is in the background. It also runs a headless JS task
 * for its lifetime – React Native pauses JS timers in the background unless a headless task is active
 * (JavaTimerManager), and the stream's throttled saves / watchdogs need them.
 *
 * Never sticky: after a process death there is no stream left to keep alive.
 */
class StreamKeepAliveService : HeadlessJsTaskService() {
  private var taskStarted = false
  private var title = ""
  private var text = ""
  private var stopLabel = ""

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        listener?.invoke("onStopRequested")
        shutdown()
        return START_NOT_STICKY
      }
      ACTION_UPDATE -> {
        if (running) {
          title = intent.getStringExtra(EXTRA_TITLE) ?: title
          text = intent.getStringExtra(EXTRA_TEXT) ?: text
          val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
          nm.notify(NOTIFICATION_ID, buildNotification())
        }
        return START_NOT_STICKY
      }
      ACTION_START -> {
        startPending = false
        title = intent.getStringExtra(EXTRA_TITLE) ?: title
        text = intent.getStringExtra(EXTRA_TEXT) ?: text
        stopLabel = intent.getStringExtra(EXTRA_STOP_LABEL) ?: stopLabel
        ensureChannel(intent.getStringExtra(EXTRA_CHANNEL_NAME) ?: title)
        try {
          ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            buildNotification(),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0,
          )
          running = true
          if (stopAfterStart) {
            // stopped by JS while this start was on its way: the promotion above satisfied Android, now end it
            stopAfterStart = false
            shutdown()
            return START_NOT_STICKY
          }
        } catch (e: Exception) {
          // ForegroundServiceStartNotAllowedException / SecurityException: give up quietly, the app falls back
          // to its "connection lost in the background" recovery UI
          Log.w(TAG, "startForeground failed: ${e.javaClass.simpleName}: ${e.message}")
          listener?.invoke("onStartFailed")
          shutdown()
          return START_NOT_STICKY
        }
        if (!taskStarted) {
          try {
            startTask(HeadlessJsTaskConfig(TASK_KEY, Arguments.createMap(), 0, true))
            taskStarted = true
          } catch (e: Exception) {
            // without the headless task JS timers stay paused in the background: a foreground service without a
            // working task gives no real protection, so stop it and let JS know (it falls back to recovery)
            Log.w(TAG, "headless task not started: ${e.message}")
            listener?.invoke("onStartFailed")
            shutdown()
          }
        }
        return START_NOT_STICKY
      }
      else -> {
        // restarted by the system without our intent: nothing to keep alive
        shutdown()
        return START_NOT_STICKY
      }
    }
  }

  /** Android 15+: dataSync services may run 6 h per 24 h; must stop within seconds of this callback. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    listener?.invoke("onTimeout")
    shutdown()
  }

  override fun onTimeout(startId: Int) {
    listener?.invoke("onTimeout")
    shutdown()
  }

  /** the user swiped the app away: the stream dies with the process anyway */
  override fun onTaskRemoved(rootIntent: Intent?) {
    shutdown()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  private fun shutdown() {
    running = false
    try {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    } catch (_: Exception) {
    }
    stopSelf()
  }

  private fun ensureChannel(name: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW)
    channel.setShowBadge(false)
    channel.setSound(null, null)
    channel.enableVibration(false)
    nm.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val immutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    val contentIntent = launch?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or immutable) }
    val stopIntent = PendingIntent.getService(
      this,
      1,
      Intent(this, StreamKeepAliveService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_UPDATE_CURRENT or immutable,
    )
    val b = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.hui_stream_keepalive)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setSilent(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setProgress(0, 0, true)
    if (contentIntent != null) b.setContentIntent(contentIntent)
    if (stopLabel.isNotEmpty()) b.addAction(0, stopLabel, stopIntent)
    return b.build()
  }

  companion object {
    const val TAG = "StreamKeepAlive"
    const val TASK_KEY = "HermesStreamKeepAlive"
    const val CHANNEL_ID = "hui-stream-keepalive"
    const val NOTIFICATION_ID = 47011
    const val ACTION_START = "ai.hermes.streamkeepalive.START"
    const val ACTION_UPDATE = "ai.hermes.streamkeepalive.UPDATE"
    const val ACTION_STOP = "ai.hermes.streamkeepalive.STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_STOP_LABEL = "stopLabel"
    const val EXTRA_CHANNEL_NAME = "channelName"

    @Volatile
    var running = false

    /**
     * a start intent was handed to startForegroundService and onStartCommand has not run yet. Stopping the service in
     * that window (stopService) makes Android kill the app (ForegroundServiceDidNotStartInTimeException): `stop` then
     * only sets [stopAfterStart] and the service shuts down right after its startForeground.
     */
    @Volatile
    var startPending = false

    @Volatile
    var stopAfterStart = false

    /** set by StreamKeepAliveModule: forwards notification actions / timeouts to JS */
    @Volatile
    var listener: ((String) -> Unit)? = null
  }
}
