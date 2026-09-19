package com.crosswise.sensors

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock

/**
 * Camera heading/pitch from the gyroscope-based game rotation vector (no magnetometer, so parked cars
 * and steel poles do not bend the heading) plus accelerometer-based walking detection.
 */
class MotionSensors(context: Context) : SensorEventListener {
    private val sensorManager = context.getSystemService(SensorManager::class.java)
    private val rotationSensor: Sensor? = sensorManager?.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
        ?: sensorManager?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    private val accelerometer: Sensor? = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private val walkingDetector = WalkingDetector()
    private val rotationMatrix = FloatArray(9)
    private var started = false

    val hasHeading: Boolean get() = rotationSensor != null

    @Volatile
    var latestOrientation: OrientationSample? = null
        private set

    @Volatile
    var isWalking: Boolean = false
        private set

    fun start() {
        if (started || sensorManager == null) return
        started = true
        rotationSensor?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        accelerometer?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
    }

    fun stop() {
        if (!started) return
        started = false
        sensorManager?.unregisterListener(this)
        walkingDetector.reset()
        isWalking = false
    }

    override fun onSensorChanged(event: SensorEvent) {
        val now = SystemClock.elapsedRealtime()
        when (event.sensor.type) {
            Sensor.TYPE_GAME_ROTATION_VECTOR, Sensor.TYPE_ROTATION_VECTOR -> {
                SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
                latestOrientation = OrientationMath.cameraOrientation(rotationMatrix, now)
            }
            Sensor.TYPE_ACCELEROMETER -> {
                walkingDetector.onAccelerometer(now, event.values[0], event.values[1], event.values[2])
                isWalking = walkingDetector.isWalking
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}
