package com.crosswise.perception

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.zip.Inflater

/**
 * Metadata that Ultralytics appends to exported `.tflite` files as a zip entry `metadata.json`
 * (class names, input size, whether the head is NMS-free). MediaPipe/TFLite-Task models append a
 * `labels.txt` the same way. Reading it lets the app accept a new model file with no code change.
 */
data class ModelMetadata(
    val names: List<String>,
    val imageSize: Pair<Int, Int>?,
    val endToEnd: Boolean?,
    val task: String?,
    val description: String?,
) {
    companion object {
        fun parse(modelBytes: ByteArray): ModelMetadata? {
            AppendedZip.readEntry(modelBytes, "metadata.json")?.let { json ->
                return runCatching { fromUltralyticsJson(String(json, Charsets.UTF_8)) }.getOrNull()
            }
            AppendedZip.readEntry(modelBytes, "labels.txt")?.let { txt ->
                val names = String(txt, Charsets.UTF_8).lines().map { it.trim() }.filter { it.isNotEmpty() }
                return ModelMetadata(names, null, null, null, null)
            }
            return null
        }

        fun fromUltralyticsJson(json: String): ModelMetadata {
            val root = JSONObject(json)
            val namesObj = root.optJSONObject("names")
            val names = if (namesObj != null) {
                val indexed = namesObj.keys().asSequence().mapNotNull { k ->
                    k.toIntOrNull()?.let { it to namesObj.getString(k) }
                }.toMap()
                (0..(indexed.keys.maxOrNull() ?: -1)).map { indexed[it] ?: "class_$it" }
            } else {
                emptyList()
            }
            val imgsz = root.optJSONArray("imgsz")?.let { arr ->
                if (arr.length() >= 2) arr.getInt(0) to arr.getInt(1) else null
            }
            return ModelMetadata(
                names = names,
                imageSize = imgsz,
                endToEnd = if (root.has("end2end")) root.optBoolean("end2end") else null,
                task = root.optString("task").ifEmpty { null },
                description = root.optString("description").ifEmpty { null },
            )
        }
    }
}

/** Minimal reader for a zip archive appended to the end of another file. */
object AppendedZip {
    private const val EOCD_SIG = 0x06054b50
    private const val CEN_SIG = 0x02014b50
    private const val LOC_SIG = 0x04034b50

    fun readEntry(bytes: ByteArray, entryName: String): ByteArray? {
        val eocd = findEocd(bytes) ?: return null
        val entries = u16(bytes, eocd + 10)
        val cenSize = u32(bytes, eocd + 12)
        val cenOffset = u32(bytes, eocd + 16)
        val cenStart = eocd - cenSize
        if (cenStart < 0) return null
        // Offsets may be relative to the start of the appended archive or absolute in the file.
        val archiveBase = cenStart - cenOffset

        var p = cenStart
        repeat(entries) {
            if (p + 46 > bytes.size || u32(bytes, p) != CEN_SIG) return null
            val method = u16(bytes, p + 10)
            val compSize = u32(bytes, p + 20)
            val uncompSize = u32(bytes, p + 24)
            val nameLen = u16(bytes, p + 28)
            val extraLen = u16(bytes, p + 30)
            val commentLen = u16(bytes, p + 32)
            val localOffset = u32(bytes, p + 42)
            val name = String(bytes, p + 46, nameLen, Charsets.UTF_8)
            if (name == entryName) {
                val loc = listOf(archiveBase + localOffset, localOffset)
                    .firstOrNull { it >= 0 && it + 30 <= bytes.size && u32(bytes, it) == LOC_SIG }
                    ?: return null
                val dataStart = loc + 30 + u16(bytes, loc + 26) + u16(bytes, loc + 28)
                if (dataStart + compSize > bytes.size) return null
                return when (method) {
                    0 -> bytes.copyOfRange(dataStart, dataStart + compSize)
                    8 -> inflate(bytes, dataStart, compSize, uncompSize)
                    else -> null
                }
            }
            p += 46 + nameLen + extraLen + commentLen
        }
        return null
    }

    private fun findEocd(bytes: ByteArray): Int? {
        val minPos = maxOf(0, bytes.size - 22 - 0xFFFF)
        var i = bytes.size - 22
        while (i >= minPos) {
            if (u32(bytes, i) == EOCD_SIG) return i
            i--
        }
        return null
    }

    private fun inflate(bytes: ByteArray, start: Int, length: Int, expected: Int): ByteArray {
        val inflater = Inflater(true)
        try {
            inflater.setInput(bytes, start, length)
            val out = ByteArrayOutputStream(maxOf(expected, 64))
            val buf = ByteArray(8192)
            while (!inflater.finished()) {
                val n = inflater.inflate(buf)
                if (n == 0 && (inflater.needsInput() || inflater.needsDictionary())) break
                out.write(buf, 0, n)
            }
            return out.toByteArray()
        } finally {
            inflater.end()
        }
    }

    private fun u16(b: ByteArray, i: Int): Int = (b[i].toInt() and 0xFF) or ((b[i + 1].toInt() and 0xFF) shl 8)

    private fun u32(b: ByteArray, i: Int): Int =
        (b[i].toInt() and 0xFF) or ((b[i + 1].toInt() and 0xFF) shl 8) or
            ((b[i + 2].toInt() and 0xFF) shl 16) or ((b[i + 3].toInt() and 0xFF) shl 24)
}
