package expo.modules.audioeditor

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import java.io.File
import kotlin.math.abs
import kotlin.math.max

/** Reads the whole file: its length and a loudness outline (one value per 100 ms) for the waveform. */
fun analyzeFile(context: Context, uri: String, isCancelled: () -> Boolean, onProgress: (Double) -> Unit): Map<String, Any?> {
  val peaks = ArrayList<Double>()
  var rate = 44100
  var perBucket = 4410
  var inBucket = 0
  var peak = 0f
  var frames = 0L
  var channels = 2
  var fileUs = 0L
  var lastReport = -1
  decodePcm(context, uri, 0, 0, isCancelled,
    onFormat = { sr, ch, durationUs -> rate = sr; channels = ch; perBucket = max(1, sr / 10); fileUs = durationUs },
    onPcm = { buf, n, ptsUs ->
      for (i in 0 until n) {
        for (c in 0 until channels) { val v = abs(buf[i * channels + c]); if (v > peak) peak = v }
        if (++inBucket >= perBucket) { peaks += peak.toDouble(); peak = 0f; inBucket = 0 }
      }
      frames += n
      if (fileUs > 0) {
        val pct = (ptsUs * 100 / fileUs).toInt()
        if (pct != lastReport) { lastReport = pct; onProgress(pct / 100.0) }
      }
    })
  if (inBucket > 0) peaks += peak.toDouble()
  if (frames == 0L) throw CodedException("ERR_ANALYZE", "This file has no sound VibeRoom can read", null)
  return mapOf("durationMs" to (frames * 1000.0 / rate), "peaks" to peaks, "sampleRate" to rate, "channels" to channels)
}

/**
 * Makes the edit and saves it on the phone. options: startMs, endMs, gainDb, eq[5], fadeInMs,
 * fadeOutMs, name, artist, kind ("ringtone" | "alarm" | "notification" | "music").
 */
fun exportFile(context: Context, uri: String, options: Map<String, Any?>, isCancelled: () -> Boolean, onProgress: (Double) -> Unit): Map<String, Any?> {
  val startMs = (options["startMs"] as? Number)?.toLong() ?: 0L
  val endMs = (options["endMs"] as? Number)?.toLong() ?: 0L
  if (endMs - startMs < 500) throw CodedException("ERR_EXPORT", "The cut is too short", null)
  val params = EditParams.from(options)
  val name = safeName(options["name"] as? String ?: "")
  val kind = Kind.of(options["kind"] as? String)
  val temp = File(context.cacheDir, "edit-${System.currentTimeMillis()}.m4a")
  var writer: AacWriter? = null
  var finished = false
  try {
    var resampler: Resampler? = null
    var processor: Processor? = null
    var outRate = 44100
    var lastReport = -1
    val lengthUs = (endMs - startMs) * 1000
    decodePcm(context, uri, startMs * 1000, endMs * 1000, isCancelled,
      onFormat = { sr, ch, _ ->
        outRate = encoderRate(sr)
        if (outRate != sr) resampler = Resampler(sr, outRate, ch)
        processor = Processor(outRate, ch, (endMs - startMs) * outRate / 1000, params)
        writer = AacWriter(temp.absolutePath, outRate, ch)
      },
      onPcm = { buf, n, ptsUs ->
        val w = writer!!
        var data = buf
        var frames = n
        resampler?.let { val r = it.process(buf, n); data = r.first; frames = r.second }
        processor!!.process(data, frames, w.framesWritten)
        w.write(data, frames)
        val pct = ((ptsUs - startMs * 1000) * 100 / lengthUs).toInt().coerceIn(0, 100)
        if (pct != lastReport) { lastReport = pct; onProgress(pct / 100.0) }
      })
    val w = writer ?: throw CodedException("ERR_EXPORT", "This file has no sound VibeRoom can read", null)
    val frames = w.framesWritten
    w.finish()
    finished = true
    if (frames == 0L) throw CodedException("ERR_EXPORT", "Nothing to save in that part of the song", null)
    val saved = saveToPhone(context, temp, name, kind, options["artist"] as? String)
    return mapOf("uri" to saved.toString(), "name" to name, "kind" to kind.key,
      "durationMs" to (frames * 1000.0 / outRate), "folder" to "${kind.dir}/VibeRoom")
  } finally {
    if (!finished) writer?.release()
    temp.delete()
  }
}
