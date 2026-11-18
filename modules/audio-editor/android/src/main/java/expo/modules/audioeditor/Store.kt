package expo.modules.audioeditor

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// Where edits are kept: the phone's own Ringtones / Alarms / Notifications / Music folders, in a
// "VibeRoom" sub-folder, so they show up in Android's sound pickers and stay after an uninstall.
enum class Kind(val key: String, val dir: String, val ringtoneType: Int) {
  RINGTONE("ringtone", Environment.DIRECTORY_RINGTONES, RingtoneManager.TYPE_RINGTONE),
  ALARM("alarm", Environment.DIRECTORY_ALARMS, RingtoneManager.TYPE_ALARM),
  NOTIFICATION("notification", Environment.DIRECTORY_NOTIFICATIONS, RingtoneManager.TYPE_NOTIFICATION),
  MUSIC("music", Environment.DIRECTORY_MUSIC, -1);

  val relativePath get() = "$dir/$FOLDER/"

  companion object {
    fun of(key: String?) = values().firstOrNull { it.key == key } ?: MUSIC
  }
}

private const val FOLDER = "VibeRoom"
private val AUDIO_URI: Uri
  get() = if (Build.VERSION.SDK_INT >= 29) MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
  else MediaStore.Audio.Media.EXTERNAL_CONTENT_URI

fun safeName(name: String): String {
  val clean = name.replace(Regex("[\\\\/:*?\"<>|\\n\\r\\t]"), " ").replace(Regex("\\s+"), " ").trim()
  return clean.take(80).ifEmpty { "VibeRoom edit" }
}

/** Copies the finished .m4a into the phone's shared storage. Returns its content:// link. */
fun saveToPhone(context: Context, temp: File, name: String, kind: Kind, artist: String?): Uri {
  val resolver = context.contentResolver
  if (Build.VERSION.SDK_INT >= 29) {
    val values = ContentValues().apply {
      put(MediaStore.Audio.Media.DISPLAY_NAME, "$name.m4a")
      put(MediaStore.Audio.Media.TITLE, name)
      if (!artist.isNullOrBlank()) put(MediaStore.Audio.Media.ARTIST, artist)
      put(MediaStore.Audio.Media.MIME_TYPE, "audio/mp4")
      put(MediaStore.Audio.Media.RELATIVE_PATH, kind.relativePath)
      put(MediaStore.Audio.Media.IS_RINGTONE, kind == Kind.RINGTONE)
      put(MediaStore.Audio.Media.IS_ALARM, kind == Kind.ALARM)
      put(MediaStore.Audio.Media.IS_NOTIFICATION, kind == Kind.NOTIFICATION)
      put(MediaStore.Audio.Media.IS_MUSIC, kind == Kind.MUSIC)
      put(MediaStore.Audio.Media.IS_PENDING, 1)
    }
    val uri = resolver.insert(AUDIO_URI, values) ?: throw IllegalStateException("The phone didn't let VibeRoom save the file")
    try {
      resolver.openOutputStream(uri)!!.use { out -> temp.inputStream().use { it.copyTo(out) } }
      resolver.update(uri, ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      resolver.delete(uri, null, null)
      throw e
    }
    return uri
  }

  // Android 9 and older: VibeRoom's own folder on the shared storage (no permission needed),
  // then ask the media scanner to add it.
  val dir = File(context.getExternalFilesDir(kind.dir), FOLDER).apply { mkdirs() }
  var file = File(dir, "$name.m4a")
  var n = 1
  while (file.exists()) file = File(dir, "$name (${n++}).m4a")
  temp.copyTo(file)
  var result: Uri? = null
  val done = CountDownLatch(1)
  MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf("audio/mp4")) { _, uri ->
    result = uri; done.countDown()
  }
  done.await(15, TimeUnit.SECONDS)
  return result ?: throw IllegalStateException("Saved, but the phone hasn't added the file to its sounds yet")
}

private fun mediaId(uri: Uri?): Long? =
  if (uri == null || uri.authority != MediaStore.AUTHORITY) null else try { ContentUris.parseId(uri) } catch (e: Exception) { null }

/** The edits saved by VibeRoom, newest first. */
fun listEdits(context: Context): List<Map<String, Any?>> {
  val defaults = Kind.values().filter { it.ringtoneType >= 0 }.associateWith {
    mediaId(RingtoneManager.getActualDefaultRingtoneUri(context, it.ringtoneType))
  }
  val projection = mutableListOf(
    MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.DURATION,
    MediaStore.Audio.Media.SIZE, MediaStore.Audio.Media.DATE_ADDED,
  )
  val selection: String
  val args: Array<String>
  if (Build.VERSION.SDK_INT >= 29) {
    projection += MediaStore.Audio.Media.RELATIVE_PATH
    selection = Kind.values().joinToString(" OR ") { "${MediaStore.Audio.Media.RELATIVE_PATH} = ?" }
    args = Kind.values().map { it.relativePath }.toTypedArray()
  } else {
    @Suppress("DEPRECATION")
    projection += MediaStore.Audio.Media.DATA
    @Suppress("DEPRECATION")
    selection = Kind.values().joinToString(" OR ") { "${MediaStore.Audio.Media.DATA} LIKE ?" }
    args = Kind.values().map { File(context.getExternalFilesDir(it.dir), FOLDER).absolutePath + "/%" }.toTypedArray()
  }

  val out = mutableListOf<Map<String, Any?>>()
  context.contentResolver.query(AUDIO_URI, projection.toTypedArray(), selection, args,
    "${MediaStore.Audio.Media.DATE_ADDED} DESC")?.use { c ->
    while (c.moveToNext()) {
      val id = c.getLong(0)
      val place = c.getString(5) ?: ""
      val kind = Kind.values().firstOrNull {
        if (Build.VERSION.SDK_INT >= 29) place == it.relativePath
        else place.contains("/${it.dir}/$FOLDER/")
      } ?: Kind.MUSIC
      out += mapOf(
        "id" to id.toString(),
        "uri" to ContentUris.withAppendedId(AUDIO_URI, id).toString(),
        "name" to (c.getString(1) ?: "VibeRoom edit"),
        "durationMs" to c.getLong(2).toDouble(),
        "size" to c.getLong(3).toDouble(),
        "addedAt" to (c.getLong(4) * 1000).toDouble(),
        "kind" to kind.key,
        "folder" to "${kind.dir}/$FOLDER",
        "isRingtone" to (defaults[Kind.RINGTONE] == id),
        "isAlarm" to (defaults[Kind.ALARM] == id),
        "isNotification" to (defaults[Kind.NOTIFICATION] == id),
      )
    }
  }
  return out
}

fun deleteEdit(context: Context, uri: String) {
  val parsed = Uri.parse(uri)
  if (Build.VERSION.SDK_INT < 29) {
    @Suppress("DEPRECATION")
    context.contentResolver.query(parsed, arrayOf(MediaStore.Audio.Media.DATA), null, null, null)?.use { c ->
      if (c.moveToFirst()) c.getString(0)?.let { File(it).delete() }
    }
  }
  context.contentResolver.delete(parsed, null, null)
}

fun setDefaultSound(context: Context, uri: String, kind: Kind) {
  require(kind.ringtoneType >= 0) { "Not a sound type" }
  RingtoneManager.setActualDefaultRingtoneUri(context, kind.ringtoneType, Uri.parse(uri))
}
