package expo.modules.crosswise

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Random

@RunWith(AndroidJUnit4::class)
class VehicleFlowTest {
  private val width = 192
  private val height = 108
  private val source = Random(37).let { rng -> List(width * height) { rng.nextInt(256).toDouble() } }
  private val texture = Random(83).let { rng -> List(width * height) { rng.nextInt(256).toDouble() } }
  private fun median(values: List<Double>) = values.sorted()[values.size / 2]
  private fun image(x0: Int): List<Double> = source.toMutableList().apply {
    for (y in 30 until 80) for (x in 0 until 60) this[y * width + x0 + x] = texture[y * width + x]
  }
  @Suppress("UNCHECKED_CAST")
  private fun flow(before: List<Double>, after: List<Double>, x0: Int): List<Map<String, Double>> {
    val result = VehicleFlow.track(before.map { it.toInt().toByte() }.toByteArray(), after.map { it.toInt().toByte() }.toByteArray(), width, height,
      listOf(listOf(x0.toDouble()/width,30.0/height,(x0+60.0)/width,80.0/height)))
    return result["points"] as List<Map<String, Double>>
  }
  @Test fun stationaryTextureHasZeroFlow() {
    val points = flow(source, source, 60)
    assertTrue("Background support", points.size >= 20)
    assertEquals(0.0, median(points.map { it.getValue("dx") }), 0.1)
    assertEquals(0.0, median(points.map { it.getValue("dy") }), 0.1)
  }
  @Test fun foregroundDirectionsSurviveBackgroundCompensation() {
    for (direction in listOf(-1,1)) {
      val x0 = 60 + direction * 4
      val points = flow(image(60), image(x0), x0)
      val local = points.filter { it.getValue("x") > x0.toDouble()/width && it.getValue("x") < (x0+60.0)/width && it.getValue("y") > 30.0/height && it.getValue("y") < 80.0/height }
      val background = points.filter { it !in local }
      assertTrue("Vehicle support", local.size >= 3)
      assertTrue("Background support", background.size >= 20)
      val residual = median(local.map { it.getValue("dx") }) - median(background.map { it.getValue("dx") })
      assertEquals("Direction $direction", direction*4.0, residual, 0.5)
    }
  }
  @Test fun cameraTranslationHasNoIndependentVehicleMotion() {
    val before = image(60)
    val after = List(width * height) { i -> before[(i / width)*width + (i % width - 2 + width) % width] }
    val points = flow(before, after, 62)
    val local = points.filter { it.getValue("x") > 62.0/width && it.getValue("x") < 122.0/width && it.getValue("y") > 30.0/height && it.getValue("y") < 80.0/height }
    val background = points.filter { it !in local }
    assertTrue(local.size >= 3 && background.size >= 20)
    assertEquals(0.0, median(local.map { it.getValue("dx") }) - median(background.map { it.getValue("dx") }), 0.3)
  }
}
