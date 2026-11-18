package expo.modules.audioeditor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

class DspTest {
  private val sr = 44100

  private fun sine(freq: Double, frames: Int, amp: Float = 0.1f, channels: Int = 2) =
    FloatArray(frames * channels) { i -> (amp * sin(2 * PI * freq * (i / channels) / sr)).toFloat() }

  private fun peak(buf: FloatArray, from: Int = 0) = buf.drop(from).maxOf { abs(it) }

  @Test fun flatLeavesSoundAlone() {
    val buf = sine(440.0, 4410)
    val orig = buf.copyOf()
    Processor(sr, 2, 4410, EditParams()).process(buf, 4410, 0)
    for (i in buf.indices) assertEquals(orig[i], buf[i], 1e-6f)
  }

  @Test fun volumeBoost() {
    val buf = sine(440.0, 4410)
    Processor(sr, 2, 4410, EditParams(gainDb = 6f)).process(buf, 4410, 0)
    assertEquals(0.1f * 1.995f, peak(buf), 0.002f)
  }

  @Test fun fadesStartAndEndSilent() {
    val frames = sr * 2
    val buf = FloatArray(frames) { 0.5f } // mono, constant
    Processor(sr, 1, frames.toLong(), EditParams(fadeInMs = 500, fadeOutMs = 500)).process(buf, frames, 0)
    assertEquals(0f, buf[0], 1e-6f)
    assertEquals(0.25f, buf[sr / 4], 0.01f)       // half way through the fade in
    assertEquals(0.5f, buf[sr], 1e-6f)            // middle: untouched
    assertTrue(buf[frames - 1] < 0.001f)          // end of the fade out
  }

  @Test fun equalizerBoostsItsBandOnly() {
    val p = EditParams(eq = floatArrayOf(0f, 0f, 6f, 0f, 0f))
    val hit = sine(910.0, sr)
    Processor(sr, 2, sr.toLong(), p).process(hit, sr, 0)
    assertEquals(0.1f * 1.995f, peak(hit, sr), 0.004f)
    val miss = sine(60.0, sr)
    Processor(sr, 2, sr.toLong(), p).process(miss, sr, 0)
    assertEquals(0.1f, peak(miss, sr), 0.004f)
  }

  @Test fun bassShelf() {
    val p = EditParams(eq = floatArrayOf(8f, 0f, 0f, 0f, 0f))
    val low = sine(25.0, sr)
    Processor(sr, 2, sr.toLong(), p).process(low, sr, 0)
    assertEquals(0.1f * 2.4f, peak(low, sr), 0.01f) // close to +8 dB below the corner
  }

  @Test fun limiterNeverClips() {
    val buf = sine(440.0, 4410, amp = 0.9f)
    Processor(sr, 2, 4410, EditParams(gainDb = 12f)).process(buf, 4410, 0)
    assertTrue(peak(buf) <= 1f)
    assertTrue(peak(buf) > 0.95f)
  }

  @Test fun chunksGiveTheSameResult() {
    val p = EditParams(gainDb = 3f, eq = floatArrayOf(4f, -2f, 3f, 1f, 5f), fadeInMs = 100, fadeOutMs = 100)
    val whole = sine(300.0, 8000)
    val parts = whole.copyOf()
    Processor(sr, 2, 8000, p).process(whole, 8000, 0)
    val proc = Processor(sr, 2, 8000, p)
    val a = parts.copyOfRange(0, 3001 * 2); val b = parts.copyOfRange(3001 * 2, parts.size)
    proc.process(a, 3001, 0); proc.process(b, 8000 - 3001, 3001)
    val joined = a + b
    for (i in whole.indices) assertEquals(whole[i], joined[i], 1e-6f)
  }

  @Test fun resamplerHalvesAndKeepsTheSine() {
    val inRate = 96000
    val frames = inRate
    val input = FloatArray(frames * 2) { i -> (0.5 * sin(2 * PI * 1000.0 * (i / 2) / inRate)).toFloat() }
    val r = Resampler(inRate, 48000, 2)
    // in two uneven chunks, to check the join
    val first = r.process(input.copyOfRange(0, 40001 * 2), 40001)
    val out1 = first.first.copyOf(first.second * 2)
    val second = r.process(input.copyOfRange(40001 * 2, input.size), frames - 40001)
    val out = out1 + second.first.copyOf(second.second * 2)
    val n = out.size / 2
    assertTrue("frames $n", abs(n - 48000) <= 2)
    for (k in 0 until n) {
      val expect = 0.5 * sin(2 * PI * 1000.0 * k / 48000)
      assertEquals("frame $k", expect.toFloat(), out[k * 2], 0.002f)
    }
  }

  @Test fun encoderRates() {
    assertEquals(44100, encoderRate(44100))
    assertEquals(48000, encoderRate(96000))
    assertEquals(44100, encoderRate(37800))
  }
}
