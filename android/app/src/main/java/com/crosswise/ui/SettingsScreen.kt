package com.crosswise.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.crosswise.R
import com.crosswise.feedback.Verbosity
import com.crosswise.settings.AppFont
import com.crosswise.settings.AppSettings
import java.util.Locale

@Composable
fun SettingsScreen(viewModel: CrossWiseViewModel, onBack: () -> Unit) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val model by viewModel.model.collectAsStateWithLifecycle()
    val update: ((AppSettings) -> AppSettings) -> Unit = viewModel::updateSettings
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) viewModel.importModel(uri)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(CrossWiseColors.Background)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Dimens.gutter, vertical = Dimens.gapMedium),
        verticalArrangement = Arrangement.spacedBy(Dimens.gapMedium),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.settings_title),
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            TextButton(onClick = onBack, modifier = Modifier.heightIn(min = Dimens.touchTarget)) {
                Text(
                    stringResource(R.string.action_back),
                    style = MaterialTheme.typography.titleMedium,
                    color = CrossWiseColors.Accent,
                )
            }
        }

        SectionCard(stringResource(R.string.settings_section_feedback)) {
            SwitchRow(stringResource(R.string.settings_speech), settings.speech) { v -> update { it.copy(speech = v) } }
            SwitchRow(stringResource(R.string.settings_tones), settings.tones) { v -> update { it.copy(tones = v) } }
            SwitchRow(stringResource(R.string.settings_haptics), settings.haptics) { v -> update { it.copy(haptics = v) } }
            SliderRow(
                label = stringResource(R.string.settings_speech_rate),
                value = settings.speechRate,
                range = 0.6f..2.0f,
                format = { String.format(Locale.US, "%.1f×", it) },
            ) { v -> update { it.copy(speechRate = v) } }
            Text(
                stringResource(R.string.settings_verbosity),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(top = Dimens.gapSmall),
            )
            Verbosity.entries.forEach { level ->
                val label = when (level) {
                    Verbosity.MINIMAL -> stringResource(R.string.verbosity_minimal)
                    Verbosity.NORMAL -> stringResource(R.string.verbosity_normal)
                    Verbosity.DETAILED -> stringResource(R.string.verbosity_detailed)
                }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = Dimens.touchTarget)
                        .selectable(
                            selected = settings.verbosity == level,
                            role = Role.RadioButton,
                            onClick = { update { it.copy(verbosity = level) } },
                        ),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = settings.verbosity == level, onClick = null)
                    Text(
                        label,
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(start = Dimens.gapMedium),
                    )
                }
            }
        }

        SectionCard(stringResource(R.string.settings_section_display)) {
            Text(stringResource(R.string.settings_font), style = MaterialTheme.typography.titleMedium)
            AppFont.entries.forEach { font ->
                val label = when (font) {
                    AppFont.MODERN -> stringResource(R.string.font_modern)
                    AppFont.CLASSIC -> stringResource(R.string.font_classic)
                    AppFont.HYPERLEGIBLE -> stringResource(R.string.font_hyperlegible)
                }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = Dimens.touchTarget)
                        .selectable(
                            selected = settings.appFont == font,
                            role = Role.RadioButton,
                            onClick = { update { it.copy(appFont = font) } },
                        ),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = settings.appFont == font, onClick = null)
                    // Each option is drawn in its own face, so the choice is visible rather than described.
                    Text(
                        label,
                        style = MaterialTheme.typography.titleMedium.copy(fontFamily = familyOf(font)),
                        modifier = Modifier.padding(start = Dimens.gapMedium),
                    )
                }
            }
            SwitchRow(stringResource(R.string.settings_large_status), settings.largeStatus) { v ->
                update { it.copy(largeStatus = v) }
            }
        }

        SectionCard(stringResource(R.string.settings_section_guidance)) {
            SwitchRow(stringResource(R.string.settings_aim_sonar), settings.aimSonar) { v ->
                update { it.copy(aimSonar = v) }
            }
            SwitchRow(stringResource(R.string.settings_veer), settings.veerGuidance) { v ->
                update { it.copy(veerGuidance = v) }
            }
            SwitchRow(stringResource(R.string.settings_vehicle_alerts), settings.vehicleAlerts) { v ->
                update { it.copy(vehicleAlerts = v) }
            }
            SwitchRow(stringResource(R.string.settings_auto_crossing), settings.autoDetectCrossing) { v ->
                update { it.copy(autoDetectCrossing = v) }
            }
            SwitchRow(stringResource(R.string.settings_volume_keys), settings.volumeKeys) { v ->
                update { it.copy(volumeKeys = v) }
            }
        }

        SectionCard(stringResource(R.string.settings_section_detection)) {
            SwitchRow(stringResource(R.string.settings_gpu), settings.useGpu) { v -> update { it.copy(useGpu = v) } }
            SliderRow(
                label = stringResource(R.string.settings_threshold),
                value = settings.scoreThreshold,
                range = 0.2f..0.7f,
                format = { String.format(Locale.US, "%.2f", it) },
            ) { v -> update { it.copy(scoreThreshold = v) } }
            SwitchRow(stringResource(R.string.settings_preview), settings.showPreview) { v ->
                update { it.copy(showPreview = v) }
            }
            SwitchRow(stringResource(R.string.settings_overlay), settings.showOverlay) { v ->
                update { it.copy(showOverlay = v) }
            }
        }

        SectionCard(stringResource(R.string.settings_section_model)) {
            Hint(
                when (val m = model) {
                    ModelState.Loading -> stringResource(R.string.model_loading)
                    ModelState.Missing -> stringResource(R.string.model_missing)
                    is ModelState.Failed -> stringResource(R.string.model_failed, m.message)
                    is ModelState.Ready ->
                        "${m.info.displayName}\n${m.info.inputWidth}×${m.info.inputHeight} · ${m.info.format} · " +
                            "${m.info.backend}\n${m.info.labels.joinToString(", ")}"
                },
            )
            BigButton(
                text = stringResource(R.string.settings_import_model),
                color = CrossWiseColors.Crossing,
                onClick = { importer.launch(arrayOf("application/octet-stream", "*/*")) },
                modifier = Modifier.fillMaxWidth().padding(top = Dimens.gapSmall),
            )
            if (settings.customModelPath != null) {
                BigButton(
                    text = stringResource(R.string.settings_use_bundled),
                    color = CrossWiseColors.Unknown,
                    onClick = viewModel::useBundledModel,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        SectionCard(stringResource(R.string.settings_section_data)) {
            SwitchRow(stringResource(R.string.settings_log), settings.logSessions) { v ->
                update { it.copy(logSessions = v) }
            }
            Hint(stringResource(R.string.settings_log_location, viewModel.logDirectory))
        }
    }
}

/** Keeps the dragged value locally and persists it once, when the gesture (or TalkBack adjustment) ends. */
@Composable
private fun SliderRow(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    format: (Float) -> String,
    onCommit: (Float) -> Unit,
) {
    var local by remember(value) { mutableFloatStateOf(value) }
    Column(Modifier.fillMaxWidth()) {
        Text("$label: ${format(local)}", style = MaterialTheme.typography.titleMedium)
        Slider(
            value = local,
            onValueChange = { local = it },
            onValueChangeFinished = { onCommit(local) },
            valueRange = range,
        )
    }
}
