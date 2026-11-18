package expo.modules.audioeditor

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

// Audio editor: cut a song, change its sound (equalizer, volume, fades), save it on the phone and
// use it as the ringtone, alarm or notification sound. Everything happens on the phone.
class AudioEditorModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val worker = Executors.newSingleThreadExecutor()
  private val generation = AtomicInteger(0) // cancel() bumps it; running jobs then stop
  private val main = Handler(Looper.getMainLooper())
  private var preview: PreviewPlayer? = null
  private val tick = object : Runnable {
    override fun run() {
      val p = preview ?: return
      p.positionMs?.let { emit("onPreviewProgress", mapOf("positionMs" to it.toDouble())) }
      main.postDelayed(this, 100)
    }
  }

  private fun emit(name: String, body: Map<String, Any?>) {
    main.post { try { sendEvent(name, body) } catch (e: Exception) { } }
  }

  private fun runJob(promise: Promise, code: String, job: (isCancelled: () -> Boolean) -> Any?) {
    val gen = generation.get()
    worker.execute {
      try {
        promise.resolve(job { generation.get() != gen })
      } catch (e: CancelledException) {
        promise.reject("ERR_CANCELLED", "Cancelled", null)
      } catch (e: CodedException) {
        promise.reject(e)
      } catch (e: Throwable) {
        Log.w("AudioEditor", "$code failed", e)
        promise.reject(code, e.message ?: "Something went wrong", e)
      }
    }
  }

  private fun stopPreview() {
    main.removeCallbacks(tick)
    preview?.finish()
    preview = null
  }

  override fun definition() = ModuleDefinition {
    Name("AudioEditor")
    Events("onProgress", "onPreviewProgress", "onPreviewEnd")

    // The song's length and loudness outline, for the waveform (see Edit.kt).
    AsyncFunction("analyze") { uri: String, promise: Promise ->
      runJob(promise, "ERR_ANALYZE") { isCancelled ->
        analyzeFile(context, uri, isCancelled) { emit("onProgress", mapOf("progress" to it)) }
      }
    }

    Function("cancel") { generation.incrementAndGet(); Unit }

    // Makes the edit and saves it on the phone (see Edit.kt for the options).
    AsyncFunction("exportEdit") { uri: String, options: Map<String, Any?>, promise: Promise ->
      runJob(promise, "ERR_EXPORT") { isCancelled ->
        exportFile(context, uri, options, isCancelled) { emit("onProgress", mapOf("progress" to it)) }
      }
    }

    Function("startPreview") { uri: String, startMs: Double, endMs: Double, params: Map<String, Any?> ->
      stopPreview()
      var player: PreviewPlayer? = null
      player = PreviewPlayer(context, uri, startMs.toLong(), endMs.toLong(), EditParams.from(params)) { error ->
        main.post {
          if (preview !== player) return@post // a newer preview has started since
          main.removeCallbacks(tick)
          preview = null
          try { sendEvent("onPreviewEnd", mapOf("error" to error)) } catch (e: Exception) { }
        }
      }
      preview = player
      player!!.start()
      main.postDelayed(tick, 100)
      Unit
    }

    Function("updatePreview") { params: Map<String, Any?> ->
      preview?.params = EditParams.from(params)
      Unit
    }

    Function("stopPreview") { stopPreview(); Unit }

    // Setting the phone's sounds needs "Modify system settings", which only the person can turn on.
    Function("canWriteSettings") { Settings.System.canWrite(context) }

    Function("openWriteSettings") {
      val intent = Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      (appContext.currentActivity ?: context).startActivity(intent)
      Unit
    }

    AsyncFunction("setAsDefault") { uri: String, kind: String ->
      if (!Settings.System.canWrite(context)) {
        throw CodedException("ERR_NEEDS_PERMISSION", "Allow VibeRoom to modify system settings first", null)
      }
      setDefaultSound(context, uri, Kind.of(kind))
      Unit
    }

    AsyncFunction("listEdits") { promise: Promise ->
      runJob(promise, "ERR_LIST") { listEdits(context) }
    }

    AsyncFunction("deleteEdit") { uri: String ->
      try {
        deleteEdit(context, uri)
      } catch (e: SecurityException) {
        throw CodedException("ERR_NOT_OWNED", "VibeRoom can't delete this file because it was made before VibeRoom was reinstalled. Delete it in your Files app.", e)
      }
      Unit
    }

    // Equalizer for songs as they play (see PlaybackEq.kt). `sessionId` is the player's audio session.
    Function("setPlaybackEq") { sessionId: Int, enabled: Boolean, gainsDb: List<Double> ->
      PlaybackEq.apply(sessionId, enabled, gainsDb)
    }

    OnDestroy {
      PlaybackEq.release()
      stopPreview()
      generation.incrementAndGet()
      worker.shutdown()
    }
  }
}
