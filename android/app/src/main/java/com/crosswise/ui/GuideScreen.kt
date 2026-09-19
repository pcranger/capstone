package com.crosswise.ui

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.crosswise.BuildConfig
import com.crosswise.R
import java.io.File

/**
 * Everything the app knows that is not a live reading: how to hold the phone, what each sound and vibration means,
 * what to do when something is wrong, what was recorded, and what this software actually is.
 *
 * A cue vocabulary that exists only in a manual nobody has is a cue vocabulary nobody knows.
 */
@Composable
fun GuideScreen(viewModel: CrossWiseViewModel) {
    val context = LocalContext.current
    val model by viewModel.model.collectAsStateWithLifecycle()
    val sessions = remember { File(viewModel.logDirectory).listFiles()?.filter { it.extension == "csv" }.orEmpty() }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Dimens.gutter, vertical = Dimens.gapMedium),
        verticalArrangement = Arrangement.spacedBy(Dimens.gapMedium),
    ) {
        Text(
            stringResource(R.string.guide_title),
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.semantics { heading() },
        )

        SectionCard(stringResource(R.string.guide_section_safety)) {
            Text(stringResource(R.string.safety_body), style = MaterialTheme.typography.bodyMedium)
        }

        SectionCard(stringResource(R.string.guide_section_holding)) {
            Text(stringResource(R.string.guide_holding), style = MaterialTheme.typography.bodyMedium)
        }

        SectionCard(stringResource(R.string.guide_section_sounds)) {
            Legend(R.string.practice_sonar, R.string.guide_sound_sonar)
            Legend(R.string.practice_centered, R.string.guide_sound_centered)
            Legend(R.string.practice_walk, R.string.guide_sound_walk)
            Legend(R.string.practice_dont_walk, R.string.guide_sound_stop)
            Legend(R.string.practice_vehicle_left, R.string.guide_sound_alert)
            Legend(R.string.practice_vehicle_close, R.string.guide_sound_critical)
            Legend(R.string.practice_bear_left, R.string.guide_sound_veer)
            Legend(R.string.practice_lost, R.string.guide_sound_lost)
        }

        SectionCard(stringResource(R.string.guide_section_haptics)) {
            Text(stringResource(R.string.guide_haptic_walk), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.guide_haptic_dont), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.guide_haptic_flashing), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.guide_haptic_alert), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.guide_haptic_tick), style = MaterialTheme.typography.bodyMedium)
        }

        SectionCard(stringResource(R.string.guide_section_trouble)) {
            Text(stringResource(R.string.guide_trouble_nosignal), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.guide_trouble_nosound), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.guide_trouble_slow), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.guide_trouble_model), style = MaterialTheme.typography.bodyMedium)
        }

        SectionCard(stringResource(R.string.guide_section_sessions)) {
            if (sessions.isEmpty()) {
                Hint(stringResource(R.string.guide_sessions_empty))
            } else {
                Hint(stringResource(R.string.guide_sessions_count, sessions.size, viewModel.logDirectory))
                sessions.sortedByDescending { it.lastModified() }.take(5).forEach { file ->
                    StatRow(file.name, "${file.length() / 1024} kB")
                }
                BigButton(
                    text = stringResource(R.string.guide_share),
                    color = CrossWiseColors.Crossing,
                    onClick = { shareLogs(context, sessions) },
                    modifier = Modifier.fillMaxWidth().padding(top = Dimens.gapSmall),
                )
            }
        }

        SectionCard(stringResource(R.string.guide_section_about)) {
            Text(
                stringResource(R.string.guide_about_version, BuildConfig.VERSION_NAME),
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                stringResource(
                    R.string.guide_about_model,
                    (model as? ModelState.Ready)?.info?.displayName ?: stringResource(R.string.model_missing),
                ),
                style = MaterialTheme.typography.bodyMedium,
            )
            Hint(stringResource(R.string.guide_about_licenses))
        }
    }
}

@Composable
private fun Legend(name: Int, meaning: Int) {
    Column(Modifier.fillMaxWidth().padding(vertical = Dimens.gapSmall / 2)) {
        Text(stringResource(name), style = MaterialTheme.typography.titleMedium)
        Hint(stringResource(meaning))
    }
}

/** Sends the CSV logs somewhere useful (email, Drive) so they can be compared with the video of a session. */
private fun shareLogs(context: android.content.Context, files: List<File>) {
    val uris = ArrayList(
        files.take(20).map { FileProvider.getUriForFile(context, "${context.packageName}.logs", it) },
    )
    val intent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
        type = "text/csv"
        putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(intent, null))
}
