package expo.modules.crosswise

import org.opencv.android.OpenCVLoader
import org.opencv.core.*
import org.opencv.imgproc.Imgproc
import org.opencv.video.Video

/** Current -> previous -> current LK, matching the existing JS classifier's sign convention. */
internal object VehicleFlow {
  private val initialized by lazy {
    check(OpenCVLoader.initLocal()) { "OpenCV could not initialize" }
    Core.setNumThreads(2)
    true
  }

  fun track(previous: ByteArray, current: ByteArray, width: Int, height: Int,
            regions: List<List<Double>>): Map<String, Any> {
    check(initialized)
    require(width in 32..384 && height in 32..384 && previous.size == width * height && current.size == previous.size)
    val started = System.nanoTime()
    val mats = mutableListOf<Mat>()
    fun <T : Mat> retain(mat: T): T { mats.add(mat); return mat }
    try {
      val before = retain(Mat(height, width, CvType.CV_8UC1))
      val after = retain(Mat(height, width, CvType.CV_8UC1))
      before.put(0, 0, previous)
      after.put(0, 0, current)
      val background = retain(Mat(height, width, CvType.CV_8UC1, Scalar(255.0)))
      val selected = mutableListOf<Point>()
      val cells = mutableSetOf<Pair<Int, Int>>()
      fun collect(mask: Mat, limit: Int) {
        val corners = MatOfPoint()
        try {
          Imgproc.goodFeaturesToTrack(after, corners, limit, 0.01, 5.0, mask, 3, false, 0.04)
          for (point in corners.toArray()) {
            if (point.x < 8 || point.y < 8 || point.x >= width - 8 || point.y >= height - 8) continue
            if (cells.add(Pair((point.x / 5).toInt(), (point.y / 5).toInt()))) selected.add(point)
          }
        } finally { corners.release() }
      }
      // Reserve points inside each vehicle before selecting distributed road/background points.
      for (region in regions.take(12)) {
        if (region.size != 4 || region.any { !it.isFinite() }) continue
        val left = (region[0] * width).toInt().coerceIn(0, width - 1)
        val top = (region[1] * height).toInt().coerceIn(0, height - 1)
        val right = (region[2] * width).toInt().coerceIn(left + 1, width)
        val bottom = (region[3] * height).toInt().coerceIn(top + 1, height)
        val rect = Rect(left, top, right - left, bottom - top)
        val mask = Mat.zeros(height, width, CvType.CV_8UC1)
        try {
          val roi = mask.submat(rect)
          try { roi.setTo(Scalar(255.0)) } finally { roi.release() }
          collect(mask, 20)
          val excluded = background.submat(rect)
          try { excluded.setTo(Scalar(0.0)) } finally { excluded.release() }
        } finally { mask.release() }
      }
      collect(background, 160)
      val points = selected.take(400)
      val result = mutableListOf<Map<String, Double>>()
      if (points.size >= 6) {
        val xy = retain(MatOfPoint2f(*points.toTypedArray()))
        val q = retain(MatOfPoint2f())
        val back = retain(MatOfPoint2f())
        val status = retain(MatOfByte())
        val reverse = retain(MatOfByte())
        val error = retain(MatOfFloat())
        val reverseError = retain(MatOfFloat())
        val criteria = TermCriteria(TermCriteria.COUNT + TermCriteria.EPS, 20, 0.01)
        Video.calcOpticalFlowPyrLK(after, before, xy, q, status, error, Size(15.0, 15.0), 2, criteria)
        Video.calcOpticalFlowPyrLK(before, after, q, back, reverse, reverseError, Size(15.0, 15.0), 2, criteria)
        val forward = q.toArray(); val backward = back.toArray()
        val valid = status.toArray(); val reverseValid = reverse.toArray()
        for (i in points.indices) {
          val p = points[i]; val f = forward[i]; val b = backward[i]
          if (valid[i].toInt() == 0 || reverseValid[i].toInt() == 0 ||
              !f.x.isFinite() || !f.y.isFinite() || !b.x.isFinite() || !b.y.isFinite() ||
              kotlin.math.hypot(p.x - b.x, p.y - b.y) >= 1.0) continue
          result.add(mapOf("x" to p.x / width, "y" to p.y / height, "dx" to p.x - f.x, "dy" to p.y - f.y))
        }
      }
      return mapOf("points" to result, "workerMs" to (System.nanoTime() - started) / 1e6)
    } finally { mats.forEach { it.release() } }
  }
}
