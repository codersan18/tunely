package expo.modules.audioeditor

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Log
import kotlin.math.max
import kotlin.math.min

/**
 * Plays the cut [startMs, endMs] with the edit applied, so changes to the equalizer, volume and
 * fades are heard straight away (`params` can change while it plays). Nothing is saved.
 */
class PreviewPlayer(
  private val context: Context,
  private val uri: String,
  private val startMs: Long,
  private val endMs: Long,
  initial: EditParams,
  private val onEnd: (error: String?) -> Unit,
) : Thread("AudioEditorPreview") {
  @Volatile private var stopped = false
  @Volatile private var track: AudioTrack? = null
  @Volatile private var rate = 44100
  @Volatile var params: EditParams = initial
    set(value) { field = value; processor?.params = value }
  @Volatile private var processor: Processor? = null

  /** Current spot in the song, in ms (null before sound starts). */
  val positionMs: Long?
    get() {
      val t = track ?: return null
      return try { startMs + t.playbackHeadPosition.toLong() * 1000 / rate } catch (e: Exception) { null }
    }

  fun finish() {
    stopped = true
    try { track?.setVolume(0f) } catch (e: Exception) { }
    interrupt()
  }

  override fun run() {
    var error: String? = null
    var written = 0L
    try {
      decodePcm(context, uri, startMs * 1000, endMs * 1000, { stopped },
        onFormat = { sampleRate, channels, _ ->
          rate = sampleRate
          val mask = if (channels == 1) AudioFormat.CHANNEL_OUT_MONO else AudioFormat.CHANNEL_OUT_STEREO
          val min = AudioTrack.getMinBufferSize(sampleRate, mask, AudioFormat.ENCODING_PCM_FLOAT)
          val t = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_MEDIA)
              .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setAudioFormat(AudioFormat.Builder()
              .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
              .setSampleRate(sampleRate)
              .setChannelMask(mask).build())
            .setBufferSizeInBytes(max(min, sampleRate * channels * 4 / 5)) // ~200 ms
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
          processor = Processor(sampleRate, channels, (endMs - startMs) * sampleRate / 1000, params)
          track = t
          t.play()
        },
        onPcm = { buf, frames, _ ->
          val t = track ?: return@decodePcm
          val ch = t.channelCount
          processor!!.process(buf, frames, written)
          // Small pieces, so stopping is quick.
          var off = 0
          val total = frames * ch
          while (off < total && !stopped) {
            val n = min(2048 * ch, total - off)
            val w = t.write(buf, off, n, AudioTrack.WRITE_BLOCKING)
            if (w <= 0) break
            off += w
          }
          written += frames
        })
      // Let the last bit play out.
      val t = track
      while (!stopped && t != null && t.playbackHeadPosition < written) sleep(30)
    } catch (e: InterruptedException) {
      // stopped
    } catch (e: CancelledException) {
      // stopped
    } catch (e: Throwable) {
      Log.w("AudioEditor", "Preview failed", e)
      error = e.message ?: "Could not play this file"
    } finally {
      try { track?.pause(); track?.flush() } catch (e: Exception) { }
      try { track?.release() } catch (e: Exception) { }
      track = null
    }
    if (!stopped) onEnd(error)
  }
}
