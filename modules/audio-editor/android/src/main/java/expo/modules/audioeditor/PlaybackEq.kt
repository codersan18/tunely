package expo.modules.audioeditor

import android.media.audiofx.Equalizer
import android.util.Log
import kotlin.math.ln

/**
 * Equalizer for songs as they play: Android's built-in Equalizer effect attached to the player's
 * audio session. The app's 5 bands (EQ_FREQS) are mapped onto however many bands the phone has,
 * by interpolating along a log-frequency scale.
 */
object PlaybackEq {
  private var eq: Equalizer? = null
  private var session = 0

  @Synchronized
  fun apply(sessionId: Int, enabled: Boolean, gainsDb: List<Double>): Map<String, Any?> {
    if (!enabled || sessionId <= 0) {
      release()
      return mapOf("active" to false, "supported" to true)
    }
    return try {
      if (eq == null || session != sessionId) {
        release()
        eq = Equalizer(1, sessionId)
        session = sessionId
      }
      val e = eq!!
      val range = e.bandLevelRange // millibels [min, max]
      for (b in 0 until e.numberOfBands) {
        val hz = e.getCenterFreq(b.toShort()) / 1000.0 // milliHertz -> Hz
        val mb = (gainAt(hz, gainsDb) * 100).toInt().coerceIn(range[0].toInt(), range[1].toInt())
        e.setBandLevel(b.toShort(), mb.toShort())
      }
      e.enabled = true
      mapOf("active" to true, "supported" to true, "bands" to e.numberOfBands.toInt())
    } catch (t: Throwable) {
      Log.w("AudioEditor", "Equalizer not available", t)
      release()
      mapOf("active" to false, "supported" to false, "error" to (t.message ?: "Not supported"))
    }
  }

  @Synchronized
  fun release() {
    try { eq?.enabled = false } catch (e: Exception) { }
    try { eq?.release() } catch (e: Exception) { }
    eq = null
    session = 0
  }

  /** The app's gain (dB) at `hz`: straight line between its bands on a log-frequency scale. */
  fun gainAt(hz: Double, gainsDb: List<Double>): Double {
    val f = EQ_FREQS
    val g = { i: Int -> gainsDb.getOrElse(i) { 0.0 } }
    if (hz <= f[0]) return g(0)
    if (hz >= f[f.size - 1]) return g(f.size - 1)
    for (i in 0 until f.size - 1) {
      if (hz <= f[i + 1]) {
        val t = (ln(hz) - ln(f[i].toDouble())) / (ln(f[i + 1].toDouble()) - ln(f[i].toDouble()))
        return g(i) + (g(i + 1) - g(i)) * t
      }
    }
    return 0.0
  }
}
