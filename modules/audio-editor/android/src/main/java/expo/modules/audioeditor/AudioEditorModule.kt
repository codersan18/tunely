package expo.modules.audioeditor

import android.content.Context
import android.content.Intent
import android.media.AudioManager
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
  private val thumbs = Executors.newFixedThreadPool(2) // video thumbnails, apart from long edits
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

    // ---- videos (see VideoEdit.kt) ----

    // Keeps the given parts of a video (trim / cut a part out), optionally without sound and
    // turned, and saves it in Movies/VibeRoom. options: { segments: [{ startMs, endMs }], mute,
    // rotate (0/90/180/270), name }. Resolves { uri, name, durationMs, size }.
    AsyncFunction("editVideo") { uri: String, options: Map<String, Any?>, promise: Promise ->
      runJob(promise, "ERR_VIDEO") { isCancelled ->
        @Suppress("UNCHECKED_CAST")
        val segments = (options["segments"] as? List<Map<String, Any?>> ?: emptyList()).map {
          ((it["startMs"] as Number).toLong() * 1000) to ((it["endMs"] as Number).toLong() * 1000)
        }
        val name = safeName(options["name"] as? String ?: "")
        var last = -1
        val (temp, durationMs) = editVideo(
          context, uri, segments,
          mute = options["mute"] == true,
          rotate = (options["rotate"] as? Number)?.toInt() ?: 0,
          isCancelled = isCancelled,
        ) { p ->
          val pct = (p * 100).toInt()
          if (pct != last) { last = pct; emit("onProgress", mapOf("progress" to p)) }
        }
        try {
          val size = temp.length()
          val saved = saveVideoToPhone(context, temp, name)
          mapOf("uri" to saved.toString(), "name" to name, "durationMs" to durationMs.toDouble(), "size" to size.toDouble())
        } finally {
          temp.delete()
        }
      }
    }

    // A small picture of a video, cached; null when it can't be read.
    AsyncFunction("videoThumbnail") { uri: String, maxSize: Int, promise: Promise ->
      thumbs.execute {
        try { promise.resolve(videoThumbnail(context, uri, maxSize)) } catch (e: Throwable) { promise.resolve(null) }
      }
    }

    // The phone's media volume (0..1), for the video player's volume swipe.
    Function("getVolume") {
      val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      am.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    }
    Function("setVolume") { value: Double ->
      val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      am.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(value.coerceIn(0.0, 1.0) * max).toInt(), 0)
      am.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / max
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
      thumbs.shutdown()
    }
  }
}
