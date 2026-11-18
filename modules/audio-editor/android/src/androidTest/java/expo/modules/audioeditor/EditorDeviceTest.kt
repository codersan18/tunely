package expo.modules.audioeditor

import android.content.Context
import android.media.RingtoneManager
import android.net.Uri
import android.provider.Settings
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.sin

// Runs on a phone or emulator: decode -> edit -> AAC -> shared storage -> ringtone, end to end.
@RunWith(AndroidJUnit4::class)
class EditorDeviceTest {
  private val ctx: Context = InstrumentationRegistry.getInstrumentation().targetContext

  /** A WAV of a 440 Hz tone at `amp`. */
  private fun wav(name: String, seconds: Int, rate: Int = 44100, channels: Int = 2, amp: Double = 0.3): File {
    val frames = rate * seconds
    val data = ByteBuffer.allocate(44 + frames * channels * 2).order(ByteOrder.LITTLE_ENDIAN)
    data.put("RIFF".toByteArray()).putInt(36 + frames * channels * 2).put("WAVE".toByteArray())
    data.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(channels.toShort()).putInt(rate)
      .putInt(rate * channels * 2).putShort((channels * 2).toShort()).putShort(16)
    data.put("data".toByteArray()).putInt(frames * channels * 2)
    for (i in 0 until frames) {
      val v = (amp * sin(2 * PI * 440.0 * i / rate) * 32767).toInt().toShort()
      repeat(channels) { data.putShort(v) }
    }
    return File(ctx.cacheDir, name).apply { writeBytes(data.array()) }
  }

  private fun peaks(r: Map<String, Any?>) = (r["peaks"] as List<*>).map { it as Double }
  private val never = { false }

  @Test fun analyzeGivesLengthAndOutline() {
    val f = wav("a.wav", 10)
    var progress = 0.0
    val r = analyzeFile(ctx, f.absolutePath, never) { progress = it }
    assertEquals(10000.0, r["durationMs"] as Double, 30.0)
    assertEquals(100, peaks(r).size)
    assertEquals(0.3, peaks(r)[50], 0.01)
    assertTrue("progress $progress", progress > 0.9)
  }

  @Test fun exportCutsFadesAndSaves() {
    val f = wav("b.wav", 10)
    val out = exportFile(ctx, Uri.fromFile(f).toString(), mapOf(
      "startMs" to 2000.0, "endMs" to 6000.0, "fadeInMs" to 1000.0, "fadeOutMs" to 1000.0,
      "name" to "VR test cut", "kind" to "ringtone",
    ), never) { }
    val uri = out["uri"] as String
    try {
      assertTrue(uri, uri.startsWith("content://media/"))
      assertEquals(4000.0, out["durationMs"] as Double, 30.0)
      assertEquals("Ringtones/VibeRoom", out["folder"])

      // Read the saved file back: right length, faded ends, full level in the middle.
      val back = analyzeFile(ctx, uri, never) { }
      assertEquals(4000.0, back["durationMs"] as Double, 120.0)
      val p = peaks(back)
      assertTrue("start ${p[0]}", p[0] < 0.05)
      assertEquals(0.3, p[p.size / 2], 0.03)
      assertTrue("end ${p.last()}", p.last() < 0.08)

      val listed = listEdits(ctx).first { it["uri"] == uri }
      assertEquals("ringtone", listed["kind"])
      assertEquals("VR test cut", listed["name"])
    } finally {
      deleteEdit(ctx, uri)
    }
    assertFalse(listEdits(ctx).any { it["uri"] == uri })
  }

  @Test fun volumeAndEqualizerChangeTheLevel() {
    val f = wav("c.wav", 4, amp = 0.2)
    val out = exportFile(ctx, f.absolutePath, mapOf(
      "startMs" to 0.0, "endMs" to 4000.0, "gainDb" to 6.0, "eq" to listOf(0.0, 6.0, 0.0, 0.0, 0.0),
      "name" to "VR test loud", "kind" to "music",
    ), never) { }
    val uri = out["uri"] as String
    try {
      assertEquals("Music/VibeRoom", out["folder"])
      // 440 Hz sits between the 230 Hz and 910 Hz bands: +6 dB volume plus part of the +6 dB band.
      val mid = peaks(analyzeFile(ctx, uri, never) { }).let { it[it.size / 2] }
      assertTrue("mid $mid", mid > 0.42 && mid < 0.75)
    } finally {
      deleteEdit(ctx, uri)
    }
  }

  @Test fun highSampleRateAndMono() {
    val hi = wav("d.wav", 3, rate = 96000, channels = 1)
    val out = exportFile(ctx, hi.absolutePath, mapOf("startMs" to 0.0, "endMs" to 3000.0, "name" to "VR test 96k", "kind" to "notification"), never) { }
    val uri = out["uri"] as String
    try {
      val back = analyzeFile(ctx, uri, never) { }
      assertEquals(48000, back["sampleRate"])
      assertEquals(1, back["channels"])
      assertEquals(3000.0, back["durationMs"] as Double, 120.0)
      assertEquals(0.3, peaks(back).let { it[it.size / 2] }, 0.03)
    } finally {
      deleteEdit(ctx, uri)
    }
  }

  @Test fun setsTheRingtone() {
    val pkg = ctx.packageName
    InstrumentationRegistry.getInstrumentation().uiAutomation
      .executeShellCommand("appops set $pkg WRITE_SETTINGS allow").close()
    Thread.sleep(500)
    assertTrue(Settings.System.canWrite(ctx))
    val before = RingtoneManager.getActualDefaultRingtoneUri(ctx, RingtoneManager.TYPE_RINGTONE)
    val f = wav("e.wav", 3)
    val uri = exportFile(ctx, f.absolutePath, mapOf("startMs" to 0.0, "endMs" to 3000.0, "name" to "VR test ring", "kind" to "ringtone"), never) { }["uri"] as String
    try {
      setDefaultSound(ctx, uri, Kind.RINGTONE)
      assertEquals(true, listEdits(ctx).first { it["uri"] == uri }["isRingtone"])
      setDefaultSound(ctx, uri, Kind.ALARM)
      assertEquals(true, listEdits(ctx).first { it["uri"] == uri }["isAlarm"])
    } finally {
      RingtoneManager.setActualDefaultRingtoneUri(ctx, RingtoneManager.TYPE_RINGTONE, before)
      deleteEdit(ctx, uri)
    }
  }

  @Test fun cancelStopsWork() {
    val f = wav("f.wav", 20)
    var calls = 0
    try {
      analyzeFile(ctx, f.absolutePath, { ++calls > 3 }) { }
      throw AssertionError("should have stopped")
    } catch (e: CancelledException) {
      // expected
    }
  }

  @Test fun previewPlaysToTheEnd() {
    val f = wav("g.wav", 5)
    val done = CountDownLatch(1)
    var error: String? = "not finished"
    var maxPos = 0L
    val player = PreviewPlayer(ctx, f.absolutePath, 1000, 2500, EditParams(gainDb = -3f)) { e -> error = e; done.countDown() }
    val started = System.currentTimeMillis()
    player.start()
    while (done.count > 0 && System.currentTimeMillis() - started < 8000) {
      player.positionMs?.let { if (it > maxPos) maxPos = it }
      player.params = EditParams(eq = floatArrayOf(3f, 0f, 0f, 0f, 0f)) // live change mid-play
      Thread.sleep(50)
    }
    assertTrue("finished", done.await(1, TimeUnit.SECONDS))
    assertNull(error)
    assertTrue("position $maxPos", maxPos in 1800..2600)
    assertTrue("took ${System.currentTimeMillis() - started}", System.currentTimeMillis() - started >= 1200)
  }

  @Test fun previewStopsQuickly() {
    val f = wav("h.wav", 10)
    var ended = false
    val player = PreviewPlayer(ctx, f.absolutePath, 0, 10000, EditParams()) { ended = true }
    player.start()
    Thread.sleep(700)
    player.finish()
    player.join(1500)
    assertFalse(player.isAlive)
    assertFalse("stopping by hand doesn't report an end", ended)
  }
}
