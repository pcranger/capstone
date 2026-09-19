package com.crosswise.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.crosswise.R

/**
 * Walking navigation: where do you want to go, and one spoken instruction at a time on the way.
 *
 * Deliberately its own tab rather than a layer over the camera. Crossing a street and walking to a shop are two
 * different jobs, and the crossing screen has no room left to host a second one — but both run at once, and a
 * route step is spoken at NORMAL priority so it can never talk over a vehicle warning.
 */
@Composable
fun NavigateScreen(viewModel: CrossWiseViewModel) {
    val route by viewModel.route.collectAsStateWithLifecycle()
    val navigating by viewModel.navigating.collectAsStateWithLifecycle()
    var destination by remember { mutableStateOf("") }
    // Asked for here, at the moment it is needed, rather than at launch: the crossing assistant works without it.
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> if (granted) viewModel.navigateTo(destination) }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Dimens.gutter, vertical = Dimens.gapMedium),
        verticalArrangement = Arrangement.spacedBy(Dimens.gapMedium),
    ) {
        Text(
            stringResource(R.string.nav_title),
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.semantics { heading() },
        )
        Hint(stringResource(R.string.nav_hint))

        SectionCard(stringResource(R.string.nav_destination)) {
            OutlinedTextField(
                value = destination,
                onValueChange = { destination = it },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            BigButton(
                text = stringResource(R.string.nav_go),
                color = CrossWiseColors.Crossing,
                enabled = destination.isNotBlank() && !navigating,
                onClick = {
                    if (viewModel.hasLocationPermission()) viewModel.navigateTo(destination)
                    else permissionLauncher.launch(android.Manifest.permission.ACCESS_FINE_LOCATION)
                },
                modifier = Modifier.fillMaxWidth().padding(top = Dimens.gapSmall),
                primary = true,
            )
        }

        route?.let { found ->
            SectionCard(found.destination) {
                Text(
                    stringResource(
                        R.string.nav_route_summary,
                        found.destination,
                        found.distanceMeters,
                        found.durationSeconds / 60,
                    ),
                    style = MaterialTheme.typography.titleMedium,
                )
                found.steps.take(8).forEach { step ->
                    StatRow(step.instruction, "${step.distanceMeters} m")
                }
                BigButton(
                    text = stringResource(R.string.nav_stop),
                    color = CrossWiseColors.DontWalk,
                    onClick = viewModel::stopNavigation,
                    modifier = Modifier.fillMaxWidth().padding(top = Dimens.gapSmall),
                )
            }
        }
    }
}
