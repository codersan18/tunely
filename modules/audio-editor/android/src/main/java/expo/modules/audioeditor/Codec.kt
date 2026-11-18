package expo.modules.audioeditor

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import java.nio.ByteOrder
import kotlin.math.min

class CancelledException : Exception("Cancelled")

fun openExtractor(context: Context, uri: String): MediaExtractor {
  val extractor = MediaExtractor()
  val parsed = Uri.parse(uri)
  when {
    uri.startsWith("/") -> extractor.setDataSource(uri)
    parsed.scheme == "file" -> extractor.setDataSource(parsed.path ?: uri)
    parsed.scheme == "http" || parsed.scheme == "https" -> extractor.setDataSource(uri, emptyMap())
    else -> extractor.setDataSource(context, parsed, null)
  }
  return extractor
}

/**
 * Decodes `uri` from `startUs` to `endUs` (≤ 0: to the end) into interleaved float samples,
 * mono or stereo. Calls `onFormat` once before the first samples and `onPcm` for each chunk.
 * `durationUs` given to onFormat is the file's length, or 0 when unknown.
 */
fun decodePcm(
  context: Context,
  uri: String,
  startUs: Long,
  endUs: Long,
  isCancelled: () -> Boolean,
  onFormat: (sampleRate: Int, channels: Int, durationUs: Long) -> Unit,
  onPcm: (buf: FloatArray, frames: Int, ptsUs: Long) -> Unit,
) {
  val extractor = openExtractor(context, uri)
  var codec: MediaCodec? = null
  try {
    val track = (0 until extractor.trackCount).firstOrNull {
      extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
    } ?: throw IllegalArgumentException("This file has no audio")
    extractor.selectTrack(track)
    val inFormat = extractor.getTrackFormat(track)
    val mime = inFormat.getString(MediaFormat.KEY_MIME)!!
    val durationUs = if (inFormat.containsKey(MediaFormat.KEY_DURATION)) inFormat.getLong(MediaFormat.KEY_DURATION) else 0L
    var sampleRate = inFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    var inChannels = inFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    var floatPcm = false

    codec = MediaCodec.createDecoderByType(mime)
    codec.configure(inFormat, null, null, 0)
    codec.start()
    if (startUs > 0) extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

    val info = MediaCodec.BufferInfo()
    var inputDone = false
    var formatSent = false
    var out = FloatArray(0)
    var shorts = ShortArray(0)
    var floats = FloatArray(0)

    while (true) {
      if (isCancelled()) throw CancelledException()
      if (!inputDone) {
        val inIdx = codec.dequeueInputBuffer(10_000)
        if (inIdx >= 0) {
          val buf = codec.getInputBuffer(inIdx)!!
          val size = extractor.readSampleData(buf, 0)
          val time = extractor.sampleTime
          if (size < 0 || (endUs > 0 && time > endUs + 500_000)) {
            codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            inputDone = true
          } else {
            codec.queueInputBuffer(inIdx, 0, size, time, 0)
            extractor.advance()
          }
        }
      }

      val outIdx = codec.dequeueOutputBuffer(info, 10_000)
      if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        val f = codec.outputFormat
        sampleRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        inChannels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        floatPcm = f.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
          f.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
        continue
      }
      if (outIdx < 0) continue

      val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
      var reachedEnd = false
      if (info.size > 0) {
        val outChannels = min(inChannels, 2)
        if (!formatSent) { onFormat(sampleRate, outChannels, durationUs); formatSent = true }
        val buf = codec.getOutputBuffer(outIdx)!!
        buf.position(info.offset); buf.limit(info.offset + info.size)
        buf.order(ByteOrder.LITTLE_ENDIAN)
        val frames = info.size / ((if (floatPcm) 4 else 2) * inChannels)
        if (out.size < frames * outChannels) out = FloatArray(frames * outChannels)
        if (floatPcm) {
          if (floats.size < frames * inChannels) floats = FloatArray(frames * inChannels)
          buf.asFloatBuffer().get(floats, 0, frames * inChannels)
          for (i in 0 until frames) for (c in 0 until outChannels) out[i * outChannels + c] = floats[i * inChannels + c]
        } else {
          if (shorts.size < frames * inChannels) shorts = ShortArray(frames * inChannels)
          buf.asShortBuffer().get(shorts, 0, frames * inChannels)
          for (i in 0 until frames) for (c in 0 until outChannels) out[i * outChannels + c] = shorts[i * inChannels + c] / 32768f
        }

        // Keep only the frames between startUs and endUs.
        val pts = info.presentationTimeUs
        var first = 0
        if (pts < startUs) first = ((startUs - pts) * sampleRate / 1_000_000).toInt().coerceIn(0, frames)
        var last = frames
        if (endUs > 0) {
          val left = ((endUs - pts) * sampleRate / 1_000_000).toInt()
          if (left < frames) { last = left.coerceAtLeast(first); reachedEnd = true }
        }
        if (last > first) {
          if (first > 0) System.arraycopy(out, first * outChannels, out, 0, (last - first) * outChannels)
          onPcm(out, last - first, pts + first * 1_000_000L / sampleRate)
        }
      }
      codec.releaseOutputBuffer(outIdx, false)
      if (eos || reachedEnd) break
    }
  } finally {
    try { codec?.stop() } catch (e: Exception) { }
    try { codec?.release() } catch (e: Exception) { }
    extractor.release()
  }
}

// Sample rates Android's AAC encoder accepts.
val AAC_RATES = intArrayOf(8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000)
fun encoderRate(rate: Int) = if (rate in AAC_RATES) rate else if (rate > 48000) 48000 else 44100

/** Encodes float samples to AAC in an .m4a file. */
class AacWriter(path: String, private val sampleRate: Int, private val channels: Int) {
  private val codec: MediaCodec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
  private val muxer = MediaMuxer(path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
  private val info = MediaCodec.BufferInfo()
  private var track = -1
  private var started = false
  private var framesIn = 0L
  private var shorts = ShortArray(0)

  init {
    val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channels).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, if (channels == 1) 128_000 else 192_000)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384 * channels)
    }
    codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    codec.start()
  }

  val framesWritten get() = framesIn

  fun write(buf: FloatArray, frames: Int) {
    val count = frames * channels
    if (shorts.size < count) shorts = ShortArray(count)
    for (i in 0 until count) shorts[i] = (buf[i].coerceIn(-1f, 1f) * 32767f).toInt().toShort()
    var off = 0
    while (off < count) {
      val idx = codec.dequeueInputBuffer(10_000)
      if (idx < 0) { drain(false); continue }
      val ib = codec.getInputBuffer(idx)!!
      ib.clear()
      var n = min(count - off, ib.remaining() / 2)
      n -= n % channels
      ib.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(shorts, off, n)
      codec.queueInputBuffer(idx, 0, n * 2, framesIn * 1_000_000L / sampleRate, 0)
      framesIn += n / channels
      off += n
      drain(false)
    }
  }

  fun finish() {
    while (true) {
      val idx = codec.dequeueInputBuffer(10_000)
      if (idx >= 0) {
        codec.queueInputBuffer(idx, 0, 0, framesIn * 1_000_000L / sampleRate, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
        break
      }
      drain(false)
    }
    drain(true)
    if (started) muxer.stop()
    release()
  }

  fun release() {
    try { codec.stop() } catch (e: Exception) { }
    try { codec.release() } catch (e: Exception) { }
    try { muxer.release() } catch (e: Exception) { }
  }

  private fun drain(endOfStream: Boolean) {
    var idle = 0
    while (true) {
      val idx = codec.dequeueOutputBuffer(info, if (endOfStream) 10_000 else 0)
      when {
        idx == MediaCodec.INFO_TRY_AGAIN_LATER -> {
          if (!endOfStream || ++idle > 500) return
        }
        idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          track = muxer.addTrack(codec.outputFormat)
          muxer.start()
          started = true
        }
        idx >= 0 -> {
          val ob = codec.getOutputBuffer(idx)!!
          if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
          if (info.size > 0 && started) {
            ob.position(info.offset); ob.limit(info.offset + info.size)
            muxer.writeSampleData(track, ob, info)
          }
          codec.releaseOutputBuffer(idx, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
        }
      }
    }
  }
}
