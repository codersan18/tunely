package expo.modules.audioeditor

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// Video editor: keep one or more parts of a video (trim, or cut a part out of the middle), drop its
// sound, turn it. The compressed video and audio are copied as they are (no re-encoding), so it's
// fast and loses no quality; each part starts at the key frame at or before its start.

private const val FOLDER = "VibeRoom"

/**
 * Writes the parts `segmentsUs` ([start, end] in microseconds, in order) of `uri` into a new .mp4,
 * with or without sound, turned by `rotate` degrees (0/90/180/270, added to the video's own
 * rotation). Calls `onProgress` with 0..1. Returns the finished temp file and its length (ms).
 */
fun editVideo(
  context: Context,
  uri: String,
  segmentsUs: List<Pair<Long, Long>>,
  mute: Boolean,
  rotate: Int,
  isCancelled: () -> Boolean,
  onProgress: (Double) -> Unit,
): Pair<File, Long> {
  require(segmentsUs.isNotEmpty()) { "Nothing to keep" }
  val extractor = openExtractor(context, uri)
  val temp = File.createTempFile("viberoom-video", ".mp4", context.cacheDir)
  var muxer: MediaMuxer? = null
  var started = false
  try {
    // Which tracks to copy: the video, and the first audio track unless the sound is removed.
    var videoTrack = -1
    var audioTrack = -1
    for (i in 0 until extractor.trackCount) {
      val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
      if (videoTrack < 0 && mime.startsWith("video/")) videoTrack = i
      if (audioTrack < 0 && mime.startsWith("audio/")) audioTrack = i
    }
    if (videoTrack < 0) throw IllegalArgumentException("This file has no video")
    if (mute) audioTrack = -1

    muxer = MediaMuxer(temp.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    val outTrack = HashMap<Int, Int>()
    var maxInput = 1 shl 20
    for (t in listOf(videoTrack, audioTrack).filter { it >= 0 }) {
      val format = extractor.getTrackFormat(t)
      if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) maxInput = maxOf(maxInput, format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE))
      try {
        outTrack[t] = muxer.addTrack(format)
      } catch (e: Exception) {
        if (t == audioTrack) continue // sound in a format MP4 can't hold: keep the picture
        throw IllegalArgumentException("This video's format can't be edited here (${format.getString(MediaFormat.KEY_MIME)})")
      }
      extractor.selectTrack(t)
    }
    val videoFormat = extractor.getTrackFormat(videoTrack)
    val ownRotation = if (videoFormat.containsKey("rotation-degrees")) videoFormat.getInteger("rotation-degrees") else 0
    muxer.setOrientationHint(((ownRotation + rotate) % 360 + 360) % 360)
    muxer.start()
    started = true

    val buffer = ByteBuffer.allocate(maxInput + 1024)
    val info = MediaCodec.BufferInfo()
    val total = segmentsUs.sumOf { (s, e) -> (e - s).coerceAtLeast(1) }.toDouble()
    var doneUs = 0L
    var offsetUs = 0L // where the current part starts in the new file
    val lastPts = HashMap<Int, Long>()
    var endOfAll = 0L

    for ((startUs, endUs) in segmentsUs) {
      // Start at the key frame at or before the part's start (both tracks follow).
      extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      var partStart = -1L // time of the part's first video frame in the original
      var partEnd = 0L
      while (true) {
        if (isCancelled()) throw CancelledException()
        val track = extractor.sampleTrackIndex
        if (track < 0) break
        val time = extractor.sampleTime
        if (time > endUs) {
          // Past the end on this track; the other track may still have samples up to the end.
          if (track == videoTrack) break
          extractor.advance(); continue
        }
        val out = outTrack[track]
        if (out == null) { extractor.advance(); continue }
        if (partStart < 0) {
          if (track != videoTrack) { extractor.advance(); continue } // sound before the first picture
          partStart = time
        }
        if (time < partStart) { extractor.advance(); continue }
        val size = extractor.readSampleData(buffer, 0)
        if (size < 0) break
        val pts = offsetUs + (time - partStart)
        if (pts > (lastPts[track] ?: -1L)) {
          info.offset = 0
          info.size = size
          info.presentationTimeUs = pts
          info.flags = if ((extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
          muxer.writeSampleData(out, buffer, info)
          lastPts[track] = pts
          partEnd = maxOf(partEnd, pts)
        }
        onProgress(((doneUs + (time - startUs).coerceIn(0, endUs - startUs)) / total).coerceIn(0.0, 1.0))
        extractor.advance()
      }
      doneUs += (endUs - startUs).coerceAtLeast(1)
      // The next part follows right after this one (one frame later).
      offsetUs = partEnd + 33_000
      endOfAll = partEnd
    }
    if (endOfAll <= 0) throw IllegalArgumentException("Nothing in the chosen part")
    muxer.stop()
    started = false
    onProgress(1.0)
    return temp to endOfAll / 1000
  } catch (e: Throwable) {
    temp.delete()
    throw e
  } finally {
    try { if (started) muxer?.stop() } catch (e: Exception) { }
    try { muxer?.release() } catch (e: Exception) { }
    extractor.release()
  }
}

private val VIDEO_URI: Uri
  get() = if (Build.VERSION.SDK_INT >= 29) MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
  else MediaStore.Video.Media.EXTERNAL_CONTENT_URI

/** Copies the finished .mp4 into Movies/VibeRoom on the phone. Returns its content:// link. */
fun saveVideoToPhone(context: Context, temp: File, name: String): Uri {
  val resolver = context.contentResolver
  if (Build.VERSION.SDK_INT >= 29) {
    val values = ContentValues().apply {
      put(MediaStore.Video.Media.DISPLAY_NAME, "$name.mp4")
      put(MediaStore.Video.Media.TITLE, name)
      put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
      put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/$FOLDER")
      put(MediaStore.Video.Media.IS_PENDING, 1)
    }
    val uri = resolver.insert(VIDEO_URI, values) ?: throw IllegalStateException("The phone didn't let VibeRoom save the video")
    try {
      resolver.openOutputStream(uri)!!.use { out -> temp.inputStream().use { it.copyTo(out) } }
      resolver.update(uri, ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      resolver.delete(uri, null, null)
      throw e
    }
    return uri
  }
  // Android 9 and older: VibeRoom's own folder on the shared storage, then the media scanner.
  val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_MOVIES), FOLDER).apply { mkdirs() }
  var file = File(dir, "$name.mp4")
  var n = 1
  while (file.exists()) file = File(dir, "$name (${n++}).mp4")
  temp.copyTo(file)
  var result: Uri? = null
  val done = CountDownLatch(1)
  MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf("video/mp4")) { _, uri ->
    result = uri; done.countDown()
  }
  done.await(15, TimeUnit.SECONDS)
  return result ?: Uri.fromFile(file)
}

/**
 * A small picture of the video (a frame a little way in), saved once in the app's cache.
 * Returns a file:// link, or null when the phone can't read a frame.
 */
fun videoThumbnail(context: Context, uri: String, maxSize: Int): String? {
  val key = MessageDigest.getInstance("MD5").digest("$uri@$maxSize".toByteArray()).joinToString("") { "%02x".format(it) }
  val dir = File(context.cacheDir, "video-thumbs").apply { mkdirs() }
  val file = File(dir, "$key.jpg")
  if (file.exists() && file.length() > 0) return Uri.fromFile(file).toString()
  val retriever = MediaMetadataRetriever()
  try {
    val parsed = Uri.parse(uri)
    when {
      uri.startsWith("/") -> retriever.setDataSource(uri)
      parsed.scheme == "file" -> retriever.setDataSource(parsed.path)
      else -> retriever.setDataSource(context, parsed)
    }
    val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
    val atUs = (durationMs * 1000 / 10).coerceAtMost(3_000_000L) // 10% in, at most 3 s
    val frame: Bitmap = (if (Build.VERSION.SDK_INT >= 27) retriever.getScaledFrameAtTime(atUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, maxSize, maxSize)
    else retriever.getFrameAtTime(atUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)) ?: return null
    val scale = minOf(1f, maxSize.toFloat() / maxOf(frame.width, frame.height))
    val small = if (scale < 1f) Bitmap.createScaledBitmap(frame, (frame.width * scale).toInt(), (frame.height * scale).toInt(), true) else frame
    FileOutputStream(file).use { small.compress(Bitmap.CompressFormat.JPEG, 80, it) }
    return Uri.fromFile(file).toString()
  } catch (e: Exception) {
    return null
  } finally {
    try { retriever.release() } catch (e: Exception) { }
  }
}
