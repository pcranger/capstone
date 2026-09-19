package com.crosswise.ui

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.BatteryManager
import android.os.SystemClock
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import com.crosswise.R
import com.crosswise.crossing.AssistMode
import com.crosswise.perception.ObjectCategory
import kotlinx.coroutines.delay

/**
 * The facts behind the phase word: where the signal is, what else is on the street, which way the traveler faces.
 * A blind user hears this on demand ("Repeat status"); a low-vision user and a sighted helper can read it.
 */
@Composable
fun ScenePanel(ui: UiState, modifier: Modifier = Modifier) {
    val snapshot = ui.snapshot
    val now = SystemClock.elapsedRealtime()
    val lines = buildList {
        val clock = Scene.signalClock(snapshot)
        val age = Scene.signalAgeSeconds(snapshot, now)
        when {
            clock != null -> add(
                stringResource(R.string.scene_signal_at, clock, (Scene.confidence(snapshot) * 100).toInt()),
            )
            age != null && age > 1 -> add(stringResource(R.string.scene_signal_stale, age))
            else -> add(stringResource(R.string.scene_signal_none))
        }

        add(stringResource(if (Scene.crosswalkSeen(snapshot)) R.string.scene_crosswalk else R.string.scene_no_crosswalk))

        val nearby = Scene.nearby(snapshot)
        if (nearby.isEmpty()) {
            add(stringResource(R.string.scene_quiet))
        } else {
            nearby.take(3).forEach { item ->
                val name = categoryName(item.category, item.count)
                add(
                    if (item.count == 1) stringResource(R.string.scene_nearby, name, item.nearestClock)
                    else stringResource(R.string.scene_nearby_many, item.count, name, item.nearestClock),
                )
            }
        }

        snapshot.aimBearingDeg?.let { bearing ->
            add(stringResource(R.string.scene_heading, Scene.compassPoint(bearing), ((bearing % 360 + 360) % 360).toInt()))
        }
        add(stringResource(if (snapshot.walking) R.string.scene_walking else R.string.scene_standing))
    }

    InfoCard(stringResource(R.string.scene_title), lines, modifier)
}

/**
 * Conditions that quietly break detection. A covered lens or a dark street looks exactly like "nothing detected",
 * so the app has to say which one it is rather than report an empty, confident-looking scene.
 */
@Composable
fun WarningsPanel(ui: UiState, model: ModelState, expanded: Boolean = true, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val assistOn = ui.snapshot.mode != AssistMode.IDLE
    val headphones by produceState(initialValue = true, assistOn) {
        while (true) {
            value = headphonesConnected(context)
            delay(4_000)
        }
    }
    val battery by produceState(initialValue = 100, assistOn) {
        while (true) {
            value = batteryPercent(context)
            delay(60_000)
        }
    }

    val warnings = buildList {
        if (assistOn && ui.frameBrightness < 0.04f) add(stringResource(R.string.warn_covered))
        else if (assistOn && ui.frameBrightness < 0.12f) add(stringResource(R.string.warn_dark))
        ui.snapshot.pitchDeg?.let { if (it < -45f) add(stringResource(R.string.warn_tilt)) }
        if (assistOn && ui.fps in 0.1f..8f) add(stringResource(R.string.warn_slow, ui.fps))
        if (!headphones) add(stringResource(R.string.warn_no_headphones))
        if (battery <= 20) add(stringResource(R.string.warn_battery, battery))
        (model as? ModelState.Ready)?.let {
            if (!it.info.hasPedestrianSignalClasses) add(stringResource(R.string.warn_baseline_model))
        }
    }
    if (warnings.isEmpty()) return

    Column(
        modifier
            .fillMaxWidth()
            .background(CrossWiseColors.Caution, RoundedCornerShape(Dimens.radiusCard))
            .padding(horizontal = Dimens.cardPadding, vertical = Dimens.gapSmall)
            .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(Dimens.gapSmall / 2),
    ) {
        // Collapsed, it is one line that says how many checks failed; open, it lists them. Either way it is
        // never silently hidden.
        Text(
            stringResource(R.string.warn_title).uppercase() + "  ·  " + warnings.size,
            style = MaterialTheme.typography.labelLarge,
            color = androidx.compose.ui.graphics.Color.White,
        )
        if (expanded) {
            warnings.forEach {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = androidx.compose.ui.graphics.Color.White)
            }
        } else {
            Text(
                warnings.first(),
                style = MaterialTheme.typography.bodyMedium,
                color = androidx.compose.ui.graphics.Color.White,
                maxLines = 1,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun InfoCard(title: String, lines: List<String>, modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .background(CrossWiseColors.Surface, RoundedCornerShape(Dimens.radiusCard))
            .padding(Dimens.cardPadding)
            .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(Dimens.gapSmall / 2),
    ) {
        Text(title.uppercase(), style = MaterialTheme.typography.labelLarge, color = CrossWiseColors.Accent)
        lines.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
    }
}

/** Two numbers side by side, used for the fps / inference readout and the crossing summary. */
@Composable
fun StatRow(left: String, right: String, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(left, style = MaterialTheme.typography.bodyMedium, color = CrossWiseColors.OnSurfaceMuted)
        Text(right, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.End)
    }
}

@Composable
private fun categoryName(category: ObjectCategory, count: Int): String = when (category) {
    ObjectCategory.PERSON -> if (count == 1) "Person" else "people"
    ObjectCategory.BICYCLE -> if (count == 1) "Bicycle" else "bicycles"
    ObjectCategory.MOTORCYCLE -> if (count == 1) "Motorcycle" else "motorcycles"
    ObjectCategory.CAR -> if (count == 1) "Car" else "cars"
    ObjectCategory.BUS -> if (count == 1) "Bus" else "buses"
    ObjectCategory.TRUCK -> if (count == 1) "Truck" else "trucks"
    else -> if (count == 1) "Object" else "objects"
}

private fun headphonesConnected(context: Context): Boolean {
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return true
    return audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
        it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
            it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
            it.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
            it.type == AudioDeviceInfo.TYPE_USB_HEADSET
    }
}

private fun batteryPercent(context: Context): Int {
    val manager = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return 100
    return manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).takeIf { it in 1..100 } ?: 100
}
