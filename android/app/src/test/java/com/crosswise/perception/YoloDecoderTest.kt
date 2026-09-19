package com.crosswise.perception

import org.junit.Assert.assertEquals
import org.junit.Test

class YoloDecoderTest {
    private val labels = listOf("ped_red", "ped_green", "car")
    private val categories = labels.map(LabelMapper::categoryFor)
    private val letterbox = Letterbox(srcWidth = 1280, srcHeight = 720, dstWidth = 640, dstHeight = 640)

    @Test
    fun letterboxGeometry() {
        assertEquals(0.5f, letterbox.scale, 1e-6f)
        assertEquals(140f, letterbox.padY, 1e-6f)
        assertEquals(0f, letterbox.padX, 1e-6f)
    }

    @Test
    fun inferFormats() {
        assertEquals(YoloOutputFormat.RAW_CHANNELS_FIRST, YoloDecoder.inferFormat(intArrayOf(1, 7, 8400), 640, 640, 3, null))
        assertEquals(YoloOutputFormat.RAW_CHANNELS_LAST, YoloDecoder.inferFormat(intArrayOf(1, 8400, 7), 640, 640, 3, null))
        assertEquals(YoloOutputFormat.END_TO_END, YoloDecoder.inferFormat(intArrayOf(1, 300, 6), 640, 640, 3, null))
        assertEquals(YoloOutputFormat.END_TO_END, YoloDecoder.inferFormat(intArrayOf(1, 300, 6), 640, 640, null, true))
        // Two classes -> 6 channels, but anchors match a raw head.
        assertEquals(YoloOutputFormat.RAW_CHANNELS_LAST, YoloDecoder.inferFormat(intArrayOf(1, 8400, 6), 640, 640, 2, false))
        assertEquals(YoloOutputFormat.RAW_CHANNELS_FIRST, YoloDecoder.inferFormat(intArrayOf(1, 6, 2100), 320, 320, null, null))
    }

    @Test
    fun decodesNormalizedRawChannelsFirstWithNms() {
        val anchors = 8400
        val channels = 4 + labels.size
        val out = FloatArray(channels * anchors)
        fun put(anchor: Int, cx: Float, cy: Float, w: Float, h: Float, cls: Int, score: Float) {
            out[0 * anchors + anchor] = cx
            out[1 * anchors + anchor] = cy
            out[2 * anchors + anchor] = w
            out[3 * anchors + anchor] = h
            out[(4 + cls) * anchors + anchor] = score
        }
        put(100, 0.5f, 0.5f, 0.1f, 0.2f, cls = 1, score = 0.9f)
        put(101, 0.505f, 0.5f, 0.1f, 0.2f, cls = 1, score = 0.6f) // duplicate, suppressed
        put(200, 0.2f, 0.5f, 0.1f, 0.1f, cls = 2, score = 0.5f)
        put(300, 0.8f, 0.5f, 0.1f, 0.1f, cls = 0, score = 0.1f) // below threshold

        val dets = YoloDecoder.decode(
            out, intArrayOf(1, channels, anchors), YoloOutputFormat.RAW_CHANNELS_FIRST, letterbox, labels, categories, 0.3f,
        )
        assertEquals(2, dets.size)
        val walk = dets.first()
        assertEquals(ObjectCategory.PED_WALK, walk.category)
        assertEquals(0.9f, walk.score, 1e-6f)
        // Model box (288,256)-(352,384) px -> source normalized.
        assertEquals(0.45f, walk.box.left, 1e-3f)
        assertEquals(0.55f, walk.box.right, 1e-3f)
        assertEquals((256f - 140f) / 0.5f / 720f, walk.box.top, 1e-3f)
        assertEquals((384f - 140f) / 0.5f / 720f, walk.box.bottom, 1e-3f)
        assertEquals(ObjectCategory.CAR, dets[1].category)
    }

    @Test
    fun decodesPixelEndToEnd() {
        val rows = 300
        val out = FloatArray(rows * 6)
        floatArrayOf(288f, 256f, 352f, 384f, 0.9f, 1f).copyInto(out, 0)
        floatArrayOf(10f, 10f, 20f, 20f, 0.2f, 0f).copyInto(out, 6)
        val dets = YoloDecoder.decode(
            out, intArrayOf(1, rows, 6), YoloOutputFormat.END_TO_END, letterbox, labels, categories, 0.3f,
        )
        assertEquals(1, dets.size)
        assertEquals(ObjectCategory.PED_WALK, dets[0].category)
        assertEquals(0.45f, dets[0].box.left, 1e-3f)
    }

    @Test
    fun decodesNormalizedEndToEnd() {
        val out = FloatArray(300 * 6)
        floatArrayOf(288f / 640f, 256f / 640f, 352f / 640f, 384f / 640f, 0.8f, 2f).copyInto(out, 0)
        val dets = YoloDecoder.decode(
            out, intArrayOf(1, 300, 6), YoloOutputFormat.END_TO_END, letterbox, labels, categories, 0.3f,
        )
        assertEquals(ObjectCategory.CAR, dets.single().category)
        assertEquals(0.55f, dets.single().box.right, 1e-3f)
    }
}
