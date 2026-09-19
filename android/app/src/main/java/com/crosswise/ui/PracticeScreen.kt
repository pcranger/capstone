package com.crosswise.ui

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
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.crosswise.R
import com.crosswise.feedback.Cue
import com.crosswise.feedback.HapticPattern
import com.crosswise.feedback.Phrase
import com.crosswise.feedback.Priority
import com.crosswise.feedback.ToneKind

/**
 * Every cue the app can produce, on demand, indoors.
 *
 * A traveler cannot learn what a rising chime versus a falling tone means while standing at a live curb — that is
 * the one place where getting it wrong is expensive. This screen is the rehearsal room, and it drives the real
 * feedback engine, not a recording, so what is learned here is exactly what is heard out there.
 */
@Composable
fun PracticeScreen(viewModel: CrossWiseViewModel) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Dimens.gutter, vertical = Dimens.gapMedium),
        verticalArrangement = Arrangement.spacedBy(Dimens.gapMedium),
    ) {
        Text(
            stringResource(R.string.practice_title),
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.semantics { heading() },
        )
        Hint(stringResource(R.string.practice_intro))

        SectionCard(stringResource(R.string.practice_signals)) {
            PracticeButton(R.string.practice_walk, CrossWiseColors.Walk, viewModel) {
                listOf(
                    Cue.Speak(Phrase.WALK_STARTED, Priority.HIGH),
                    Cue.Tone(ToneKind.WALK_CHIME),
                    Cue.Haptic(HapticPattern.WALK),
                )
            }
            PracticeButton(R.string.practice_walk_old, CrossWiseColors.Caution, viewModel) {
                listOf(Cue.Speak(Phrase.WALK_ALREADY_ON, Priority.HIGH), Cue.Haptic(HapticPattern.WALK))
            }
            PracticeButton(R.string.practice_flashing, CrossWiseColors.Caution, viewModel) {
                listOf(Cue.Speak(Phrase.WALK_FLASHING, Priority.HIGH), Cue.Haptic(HapticPattern.FLASHING))
            }
            PracticeButton(R.string.practice_dont_walk, CrossWiseColors.DontWalk, viewModel) {
                listOf(
                    Cue.Speak(Phrase.DONT_WALK, Priority.NORMAL),
                    Cue.Tone(ToneKind.STOP),
                    Cue.Haptic(HapticPattern.DONT_WALK),
                )
            }
            PracticeButton(R.string.practice_lost, CrossWiseColors.Unknown, viewModel) {
                listOf(
                    Cue.Speak(Phrase.SIGNAL_LOST, Priority.NORMAL),
                    Cue.Tone(ToneKind.LOST),
                    Cue.Haptic(HapticPattern.LOST),
                )
            }
        }

        SectionCard(stringResource(R.string.practice_hazards)) {
            PracticeButton(R.string.practice_vehicle_left, CrossWiseColors.Hazard, viewModel) {
                listOf(
                    Cue.Speak(Phrase.VEHICLE_LEFT, Priority.HIGH),
                    Cue.Tone(ToneKind.ALERT, pan = -1f),
                    Cue.Haptic(HapticPattern.ALERT),
                )
            }
            PracticeButton(R.string.practice_vehicle_ahead, CrossWiseColors.Hazard, viewModel) {
                listOf(Cue.Speak(Phrase.VEHICLE_AHEAD, Priority.HIGH), Cue.Tone(ToneKind.ALERT))
            }
            PracticeButton(R.string.practice_vehicle_right, CrossWiseColors.Hazard, viewModel) {
                listOf(
                    Cue.Speak(Phrase.VEHICLE_RIGHT, Priority.HIGH),
                    Cue.Tone(ToneKind.ALERT, pan = 1f),
                    Cue.Haptic(HapticPattern.ALERT),
                )
            }
            PracticeButton(R.string.practice_vehicle_close, CrossWiseColors.DontWalk, viewModel) {
                listOf(
                    Cue.Speak(Phrase.VEHICLE_CLOSE_LEFT, Priority.CRITICAL),
                    Cue.Tone(ToneKind.CRITICAL, pan = -1f),
                    Cue.Haptic(HapticPattern.CRITICAL),
                )
            }
        }

        SectionCard(stringResource(R.string.practice_guidance)) {
            PracticeButton(R.string.practice_sonar, CrossWiseColors.Crossing, viewModel) {
                listOf(Cue.Tone(ToneKind.SONAR, pan = -0.6f), Cue.Tone(ToneKind.SONAR, pan = 0.6f))
            }
            PracticeButton(R.string.practice_centered, CrossWiseColors.Crossing, viewModel) {
                listOf(
                    Cue.Speak(Phrase.SIGNAL_CENTERED, Priority.NORMAL),
                    Cue.Tone(ToneKind.CENTERED),
                    Cue.Haptic(HapticPattern.CENTERED_TICK),
                )
            }
            PracticeButton(R.string.practice_bear_left, CrossWiseColors.Crossing, viewModel) {
                listOf(
                    Cue.Speak(Phrase.BEAR_LEFT, Priority.HIGH),
                    Cue.Tone(ToneKind.VEER, pan = -1f),
                    Cue.Haptic(HapticPattern.VEER_LEFT),
                )
            }
            PracticeButton(R.string.practice_bear_right, CrossWiseColors.Crossing, viewModel) {
                listOf(
                    Cue.Speak(Phrase.BEAR_RIGHT, Priority.HIGH),
                    Cue.Tone(ToneKind.VEER, pan = 1f),
                    Cue.Haptic(HapticPattern.VEER_RIGHT),
                )
            }
            PracticeButton(R.string.practice_crossing, CrossWiseColors.Crossing, viewModel) {
                listOf(Cue.Speak(Phrase.CROSSING_STARTED, Priority.HIGH))
            }
        }
    }
}

@Composable
private fun PracticeButton(
    label: Int,
    color: androidx.compose.ui.graphics.Color,
    viewModel: CrossWiseViewModel,
    cues: () -> List<Cue>,
) {
    BigButton(
        text = stringResource(label),
        color = color,
        onClick = { viewModel.practice(cues()) },
        modifier = Modifier.fillMaxWidth(),
    )
}
