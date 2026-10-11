package expo.modules.crosswise

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.atan

/** Android adapter for the shared TypeScript motion, feedback and camera logic. */
class CrossWiseNativeModule : Module(), SensorEventListener {
  private val context get() = requireNotNull(appContext.reactContext)
  private val sensors get() = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  private val main = Handler(Looper.getMainLooper())
  private var active = false
  private val acceleration = FloatArray(3)
  private var hasAcceleration = false
  private val vibrator: Vibrator get() = if (Build.VERSION.SDK_INT >= 31)
    (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    else @Suppress("DEPRECATION") (context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator)

  override fun definition() = ModuleDefinition {
    Name("CrossWiseNative")
    Events("onMotion")
    Function("isMotionAvailable") { sensors.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR) != null && sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null }
    Function("startMotion") { intervalMs: Double ->
      if (!active) {
        val rotation = sensors.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
        val accel = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        if (rotation != null && accel != null) {
          hasAcceleration = false
          val period = (intervalMs.coerceIn(10.0, 1000.0) * 1000).toInt()
          val rotationReady = sensors.registerListener(this@CrossWiseNativeModule, rotation, period, main)
          val accelerationReady = sensors.registerListener(this@CrossWiseNativeModule, accel, period, main)
          active = rotationReady && accelerationReady
          if (!active) sensors.unregisterListener(this@CrossWiseNativeModule)
        }
      }
    }
    Function("stopMotion") { stopMotion() }
    OnActivityEntersBackground { stopMotion(); vibrator.cancel() }
    OnDestroy { stopMotion(); vibrator.cancel() }
    Function("supportsHaptics") { vibrator.hasVibrator() }
    Function("playHaptic") { timings: List<Double>, amplitudes: List<Double> ->
      if (timings.isNotEmpty() && timings.any { it > 0 } && vibrator.hasVibrator()) {
        val times = timings.map { it.coerceIn(0.0, 5000.0).toLong() }.toLongArray()
        val strengths = times.indices.map { amplitudes.getOrNull(it)?.toInt()?.coerceIn(0, 255) ?: if (it % 2 == 1) 255 else 0 }.toIntArray()
        vibrator.vibrate(VibrationEffect.createWaveform(times, strengths, -1))
      }
    }
    Function("cancelHaptics") { vibrator.cancel() }
    Function("headphonesConnected") {
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { it.type in setOf(
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_BLE_HEADSET) }
    }
    AsyncFunction("batteryPercent") {
      (context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    }
    Function("cameraFieldOfView") { deviceId: String? -> cameraFieldOfView(deviceId) }
  }

  private fun stopMotion() {
    if (active) sensors.unregisterListener(this)
    active = false; hasAcceleration = false
  }
  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
  override fun onSensorChanged(event: SensorEvent) {
    if (!active) return
    if (event.sensor.type == Sensor.TYPE_ACCELEROMETER) { event.values.copyInto(acceleration, endIndex = 3); hasAcceleration = true }
    if (event.sensor.type == Sensor.TYPE_GAME_ROTATION_VECTOR && hasAcceleration) {
      val q = FloatArray(4); SensorManager.getQuaternionFromVector(q, event.values)
      sendEvent("onMotion", mapOf("qx" to q[1].toDouble(), "qy" to q[2].toDouble(), "qz" to q[3].toDouble(), "qw" to q[0].toDouble(),
        "ax" to acceleration[0].toDouble(), "ay" to acceleration[1].toDouble(), "az" to acceleration[2].toDouble()))
    }
  }
  private fun cameraFieldOfView(id: String?): Map<String, Double>? = runCatching {
    val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    val selected = id?.takeIf { it in manager.cameraIdList } ?: manager.cameraIdList.firstOrNull {
      manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
    } ?: return null
    val c = manager.getCameraCharacteristics(selected)
    val physical = c.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE) ?: return null
    val pixels = c.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE) ?: return null
    val focal = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull() ?: return null
    mapOf("fovDeg" to Math.toDegrees(2 * atan(maxOf(physical.width, physical.height) / (2.0 * focal))),
      "width" to maxOf(pixels.width, pixels.height).toDouble(), "height" to minOf(pixels.width, pixels.height).toDouble())
  }.getOrNull()
}
