package expo.modules.audioeditor

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tanh

// Centre frequencies of the 5 equalizer bands (Hz). The lowest is a low shelf, the highest a
// high shelf, the others are peaking filters.
val EQ_FREQS = floatArrayOf(60f, 230f, 910f, 3600f, 14000f)

class EditParams(
  val gainDb: Float = 0f,
  val eq: FloatArray = FloatArray(EQ_FREQS.size),
  val fadeInMs: Int = 0,
  val fadeOutMs: Int = 0,
) {
  companion object {
    fun from(map: Map<String, Any?>?): EditParams {
      if (map == null) return EditParams()
      val num = { key: String -> (map[key] as? Number)?.toFloat() ?: 0f }
      val eq = FloatArray(EQ_FREQS.size)
      (map["eq"] as? List<*>)?.forEachIndexed { i, v -> if (i < eq.size) eq[i] = ((v as? Number)?.toFloat() ?: 0f).coerceIn(-15f, 15f) }
      return EditParams(
        gainDb = num("gainDb").coerceIn(-20f, 20f),
        eq = eq,
        fadeInMs = num("fadeInMs").toInt().coerceAtLeast(0),
        fadeOutMs = num("fadeOutMs").toInt().coerceAtLeast(0),
      )
    }
  }
}

// One biquad filter (RBJ audio EQ cookbook), normalised so a0 = 1.
class Coeffs(val b0: Double, val b1: Double, val b2: Double, val a1: Double, val a2: Double)

fun bandCoeffs(band: Int, gainDb: Float, sampleRate: Int): Coeffs {
  val f = min(EQ_FREQS[band].toDouble(), sampleRate * 0.45)
  val a = 10.0.pow(gainDb / 40.0)
  val w0 = 2 * PI * f / sampleRate
  val cw = cos(w0)
  val sw = sin(w0)
  val b0: Double; val b1: Double; val b2: Double; val a0: Double; val a1: Double; val a2: Double
  when (band) {
    0 -> { // low shelf, slope 1
      val alpha = sw / 2 * sqrt(2.0)
      val k = 2 * sqrt(a) * alpha
      b0 = a * ((a + 1) - (a - 1) * cw + k)
      b1 = 2 * a * ((a - 1) - (a + 1) * cw)
      b2 = a * ((a + 1) - (a - 1) * cw - k)
      a0 = (a + 1) + (a - 1) * cw + k
      a1 = -2 * ((a - 1) + (a + 1) * cw)
      a2 = (a + 1) + (a - 1) * cw - k
    }
    EQ_FREQS.size - 1 -> { // high shelf, slope 1
      val alpha = sw / 2 * sqrt(2.0)
      val k = 2 * sqrt(a) * alpha
      b0 = a * ((a + 1) + (a - 1) * cw + k)
      b1 = -2 * a * ((a - 1) + (a + 1) * cw)
      b2 = a * ((a + 1) + (a - 1) * cw - k)
      a0 = (a + 1) - (a - 1) * cw + k
      a1 = 2 * ((a - 1) - (a + 1) * cw)
      a2 = (a + 1) - (a - 1) * cw - k
    }
    else -> { // peaking, Q 1.0
      val alpha = sw / 2.0
      b0 = 1 + alpha * a
      b1 = -2 * cw
      b2 = 1 - alpha * a
      a0 = 1 + alpha / a
      a1 = -2 * cw
      a2 = 1 - alpha / a
    }
  }
  return Coeffs(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
}

// Applies the equalizer, volume and fades to interleaved float samples, then a soft limiter so
// boosting never clips harshly. `totalFrames` is the length of the cut (for the fade-out).
class Processor(private val sampleRate: Int, private val channels: Int, private val totalFrames: Long, initial: EditParams) {
  @Volatile var params: EditParams = initial
  private var applied: EditParams? = null
  private var coeffs: Array<Coeffs?> = arrayOfNulls(EQ_FREQS.size)
  private var gain = 1.0
  // Filter memory per band and channel: x1, x2, y1, y2.
  private val state = Array(EQ_FREQS.size) { Array(channels) { DoubleArray(4) } }

  private fun refresh() {
    val p = params
    if (p === applied) return
    applied = p
    coeffs = Array(EQ_FREQS.size) { b -> if (abs(p.eq[b]) < 0.05f) null else bandCoeffs(b, p.eq[b], sampleRate) }
    gain = 10.0.pow(p.gainDb / 20.0)
  }

  /** `firstFrame`: index of buf's first frame within the cut. */
  fun process(buf: FloatArray, frames: Int, firstFrame: Long) {
    refresh()
    val p = applied!!
    val fadeIn = p.fadeInMs.toLong() * sampleRate / 1000
    val fadeOut = p.fadeOutMs.toLong() * sampleRate / 1000
    for (i in 0 until frames) {
      val pos = firstFrame + i
      var env = gain
      if (fadeIn > 0 && pos < fadeIn) env *= curve(pos.toDouble() / fadeIn)
      val left = totalFrames - pos
      if (fadeOut > 0 && left < fadeOut) env *= curve(left.coerceAtLeast(0).toDouble() / fadeOut)
      for (c in 0 until channels) {
        val idx = i * channels + c
        var x = buf[idx].toDouble()
        for (b in coeffs.indices) {
          val k = coeffs[b] ?: continue
          val s = state[b][c]
          val y = k.b0 * x + k.b1 * s[0] + k.b2 * s[1] - k.a1 * s[2] - k.a2 * s[3]
          s[1] = s[0]; s[0] = x; s[3] = s[2]; s[2] = y
          x = y
        }
        buf[idx] = limit(x * env).toFloat()
      }
    }
  }

  private fun curve(t: Double) = (1 - cos(PI * t.coerceIn(0.0, 1.0))) / 2

  private fun limit(x: Double): Double {
    val knee = 0.89
    val ax = abs(x)
    if (ax <= knee) return x
    val y = knee + (1 - knee) * tanh((ax - knee) / (1 - knee))
    return if (x < 0) -y else y
  }
}

// Straight-line resampler, used only when the AAC encoder can't take the song's sample rate
// (for example 88.2 or 96 kHz FLAC). Works across chunks.
class Resampler(inRate: Int, outRate: Int, private val channels: Int) {
  private val step = inRate.toDouble() / outRate
  private var pos = 0.0
  private val prev = FloatArray(channels)
  private var out = FloatArray(0)

  fun process(input: FloatArray, frames: Int): Pair<FloatArray, Int> {
    val need = ((frames / step) + 2).toInt() * channels
    if (out.size < need) out = FloatArray(need)
    var n = 0
    while (pos < frames - 1) {
      val i = pos.toInt().let { if (pos < 0) -1 else it }
      val frac = (pos - i).toFloat()
      for (c in 0 until channels) {
        val s0 = if (i < 0) prev[c] else input[i * channels + c]
        val s1 = input[(i + 1) * channels + c]
        out[n * channels + c] = s0 + (s1 - s0) * frac
      }
      n++
      pos += step
    }
    pos -= frames
    if (frames > 0) for (c in 0 until channels) prev[c] = input[(frames - 1) * channels + c]
    return Pair(out, n)
  }
}
