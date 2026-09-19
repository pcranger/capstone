package com.crosswise.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.crosswise.R

/**
 * The design system: see docs/UI_DESIGN.md for the reasoning.
 *
 * Dark only, on purpose — it is the readable option at a night crossing, and it does not turn the phone into a lamp
 * in the traveler's face. Color means state and nothing else.
 */
object CrossWiseColors {
    val Background = Color(0xFF0B0F12)
    val Surface = Color(0xFF161C21)
    val SurfaceVariant = Color(0xFF222A30)
    val OnSurface = Color(0xFFF2F5F7)
    val OnSurfaceMuted = Color(0xFFA8B4BD)

    // State colors. Each keeps at least 6:1 against the white text placed on it.
    val Walk = Color(0xFF1B5E20)
    val Caution = Color(0xFF7A5C00)
    val DontWalk = Color(0xFFB71C1C)
    val Crossing = Color(0xFF0D47A1)
    val Unknown = Color(0xFF37474F)
    val Hazard = Color(0xFFFFD600)
    val OnHazard = Color.Black

    /** Chrome accent — deliberately lighter and less saturated than [Crossing], so it never reads as a state. */
    val Accent = Color(0xFF8AB4F8)
}

/** One 4dp scale for the whole app; no view invents its own numbers. */
object Dimens {
    val gutter = 16.dp
    val cardPadding = 20.dp
    val gapSmall = 8.dp
    val gapMedium = 12.dp
    val gapLarge = 20.dp

    val radiusHero = 28.dp
    val radiusCard = 20.dp
    val radiusRow = 12.dp

    /** Above Android's 48dp floor: this app is used standing, moving, sometimes one-handed. */
    val touchTarget = 56.dp
    val primaryButton = 64.dp
    val secondaryButton = 56.dp
    /** The preview is a strip now: the screen's job is information, not video. */
    val previewHeight = 160.dp
}

/**
 * Atkinson Hyperlegible (Braille Institute, SIL OFL 1.1) — drawn for low-vision readers: the glyphs that blur
 * together in other faces (I l 1, O 0, a e s) are given distinct shapes. A functional choice, not a stylistic one.
 */
private val Hyperlegible = FontFamily(
    Font(R.font.atkinson_regular, FontWeight.Normal),
    Font(R.font.atkinson_bold, FontWeight.Bold),
)

private fun style(size: Int, weight: FontWeight, line: Int, tracking: Float = 0f) = TextStyle(
    fontFamily = Hyperlegible,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = line.sp,
    letterSpacing = tracking.sp,
)

val CrossWiseTypography = Typography(
    // The phase word, and nothing else, gets this size.
    displayLarge = style(56, FontWeight.Bold, 60, -0.5f),
    headlineMedium = style(28, FontWeight.Bold, 34),
    titleLarge = style(22, FontWeight.Bold, 28),
    titleMedium = style(19, FontWeight.Bold, 24),
    bodyLarge = style(18, FontWeight.Normal, 26),
    bodyMedium = style(16, FontWeight.Normal, 23),
    labelLarge = style(14, FontWeight.Bold, 18, 1.1f),
    labelMedium = style(13, FontWeight.Normal, 17),
)

@Composable
fun CrossWiseTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = CrossWiseColors.Accent,
            onPrimary = Color.Black,
            secondary = CrossWiseColors.Accent,
            background = CrossWiseColors.Background,
            onBackground = CrossWiseColors.OnSurface,
            surface = CrossWiseColors.Surface,
            onSurface = CrossWiseColors.OnSurface,
            surfaceVariant = CrossWiseColors.SurfaceVariant,
            onSurfaceVariant = CrossWiseColors.OnSurfaceMuted,
            error = CrossWiseColors.DontWalk,
        ),
        typography = CrossWiseTypography,
    ) {
        // Surface is what publishes LocalContentColor. Without it every Text that does not name a color is drawn
        // black — on this background, invisible. That was a real bug, not a theoretical one.
        Surface(color = CrossWiseColors.Background, contentColor = CrossWiseColors.OnSurface, content = content)
    }
}
