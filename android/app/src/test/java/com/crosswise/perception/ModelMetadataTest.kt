package com.crosswise.perception

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class ModelMetadataTest {
    private val json = """
        {"description": "Ultralytics YOLO26n model trained on crosswise.yaml", "author": "Ultralytics",
         "names": {"0": "ped_red", "1": "ped_green", "2": "crosswalk"}, "imgsz": [640, 640],
         "end2end": true, "task": "detect", "stride": 32}
    """.trimIndent()

    private fun fakeModelWithZip(entries: Map<String, ByteArray>, stored: Boolean = false): ByteArray {
        val prefix = ByteArray(4096) { (it * 31).toByte() } // stands in for the flatbuffer
        val zip = ByteArrayOutputStream()
        ZipOutputStream(zip).use { zos ->
            entries.forEach { (name, data) ->
                val entry = ZipEntry(name)
                if (stored) {
                    entry.method = ZipEntry.STORED
                    entry.size = data.size.toLong()
                    entry.compressedSize = data.size.toLong()
                    entry.crc = CRC32().apply { update(data) }.value
                }
                zos.putNextEntry(entry)
                zos.write(data)
                zos.closeEntry()
            }
        }
        return prefix + zip.toByteArray()
    }

    @Test
    fun readsDeflatedUltralyticsMetadata() {
        val bytes = fakeModelWithZip(mapOf("metadata.json" to json.toByteArray()))
        val meta = ModelMetadata.parse(bytes)!!
        assertEquals(listOf("ped_red", "ped_green", "crosswalk"), meta.names)
        assertEquals(640 to 640, meta.imageSize)
        assertEquals(true, meta.endToEnd)
        assertEquals("detect", meta.task)
    }

    @Test
    fun readsStoredLabelsTxt() {
        val bytes = fakeModelWithZip(mapOf("labels.txt" to "person\nbicycle\ncar\n".toByteArray()), stored = true)
        assertEquals(listOf("person", "bicycle", "car"), ModelMetadata.parse(bytes)!!.names)
    }

    @Test
    fun missingZipReturnsNull() {
        assertNull(ModelMetadata.parse(ByteArray(1000) { 7 }))
    }
}
