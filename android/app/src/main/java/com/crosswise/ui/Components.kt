package com.crosswise.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign

/** A group of related settings. One heading, one surface, rows inside — instead of a flat wall of switches. */
@Composable
fun SectionCard(title: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .background(CrossWiseColors.Surface, RoundedCornerShape(Dimens.radiusCard))
            .padding(Dimens.cardPadding),
        verticalArrangement = Arrangement.spacedBy(Dimens.gapSmall),
    ) {
        Text(
            title.uppercase(),
            style = MaterialTheme.typography.labelLarge,
            color = CrossWiseColors.Accent,
            modifier = Modifier.semantics { heading() },
        )
        content()
    }
}

/** Label on the left, control on the right, one uniform height everywhere in Settings. */
@Composable
fun SettingRow(label: String, control: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = Dimens.touchTarget),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.weight(1f).padding(end = Dimens.gapMedium),
        )
        control()
    }
}

/** The whole row toggles, not just the switch: a bigger target, and one announcement for TalkBack. */
@Composable
fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = Dimens.touchTarget)
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.weight(1f).padding(end = Dimens.gapMedium),
        )
        Switch(
            checked = checked,
            onCheckedChange = null,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.Black,
                checkedTrackColor = CrossWiseColors.Accent,
                uncheckedTrackColor = CrossWiseColors.SurfaceVariant,
            ),
        )
    }
}

/** Quiet explanatory text under a row or card. */
@Composable
fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = CrossWiseColors.OnSurfaceMuted, modifier = modifier)
}

/**
 * The one button style in the app. `primary` makes it taller — the button a traveler reaches for without looking
 * is physically bigger, not just a different color.
 */
@Composable
fun BigButton(
    text: String,
    color: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    primary: Boolean = false,
) {
    // Amber is the one state color that white text cannot sit on (1.1:1); it always takes black.
    val content = if (color == CrossWiseColors.Hazard) CrossWiseColors.OnHazard else Color.White
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = if (primary) Dimens.primaryButton else Dimens.secondaryButton),
        shape = RoundedCornerShape(Dimens.radiusCard),
        colors = ButtonDefaults.buttonColors(
            containerColor = color,
            contentColor = content,
            disabledContainerColor = CrossWiseColors.SurfaceVariant,
            disabledContentColor = CrossWiseColors.OnSurfaceMuted,
        ),
    ) {
        Text(
            text,
            style = if (primary) MaterialTheme.typography.titleLarge else MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
    }
}