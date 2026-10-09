package com.crosswise.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.crosswise.R
import com.crosswise.settings.AppFont

/**
 * The design system: see docs/UI_DESIGN.md.
 *
 * Dark only, on purpose — it is the readable option at a night crossing, it does not turn the phone into a lamp in
 * the traveler's face, and it lets the camera be the surface everything else floats over. Color means state.
 */
object CrossWiseColors {
    val Background = Color(0xFF0B0F12)
    val Surface = Color(0xFF161C21)
    val SurfaceVariant = Color(0xFF222A30)
    val OnSurface = Color(0xFFF2F5F7)
    val OnSurfaceMuted = Color(0xFFA8B4BD)

    /** Panels that float over the camera: dark enough to read on, sheer enough to keep the street visible. */
    val Glass = Color(0xE60D1216)
    val GlassLight = Color(0x1AFFFFFF)
    val Hairline = Color(0x33FFFFFF)

    // State colors. Each keeps at least 6:1 against the text placed on it.
    val Walk = Color(0xFF1B5E20)
    val Caution = Color(0xFF7A5C00)
    val DontWalk = Color(0xFFB71C1C)
    val Crossing = Color(0xFF0D47A1)
    val Unknown = Color(0xFF37474F)
    val Hazard = Color(0xFFFFD600)
    val OnHazard = Color.Black

    /** Chrome accent — lighter and less saturated than [Crossing], so it never reads as a state. */
    val Accent = Color(0xFF8AB4F8)

    /** Keeps the top and bottom chrome legible over a bright sky without hiding the view. */
    val TopScrim = Brush.verticalGradient(listOf(Color(0xB3000000), Color.Transparent))
    val BottomScrim = Brush.verticalGradient(listOf(Color.Transparent, Color(0xCC000000)))
}

/** One 4dp scale for the whole app; no view invents its own numbers. */
object Dimens {
    val gutter = 16.dp
    val cardPadding = 16.dp
    val gapSmall = 8.dp
    val gapMedium = 12.dp
    val gapLarge = 20.dp

    val radiusHero = 24.dp
    val radiusCard = 18.dp
    val radiusRow = 12.dp
    val radiusPill = 28.dp

    /** Android's floor is 48dp; this app is used standing and one-handed, so controls stay at 56. */
    val touchTarget = 56.dp
    val primaryButton = 56.dp
    val secondaryButton = 48.dp
}

private val Modern = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_bold, FontWeight.Bold),
)

/** Tinos: metric-compatible with Times New Roman, and the closest thing to it that can be redistributed. */
private val Classic = FontFamily(
    Font(R.font.tinos_regular, FontWeight.Normal),
    Font(R.font.tinos_bold, FontWeight.Bold),
)

/**
 * Atkinson Hyperlegible (Braille Institute, SIL OFL 1.1) — drawn for low-vision readers: the glyphs that blur
 * together in other faces (I l 1, O 0, a e s) are given distinct shapes.
 */
private val Hyperlegible = FontFamily(
    Font(R.font.atkinson_regular, FontWeight.Normal),
    Font(R.font.atkinson_bold, FontWeight.Bold),
)

fun familyOf(font: AppFont): FontFamily = when (font) {
    AppFont.MODERN -> Modern
    AppFont.CLASSIC -> Classic
    AppFont.HYPERLEGIBLE -> Hyperlegible
}

/**
 * Sized for a camera-first screen: the phase word is prominent but no longer eats the viewfinder. Low-vision users
 * who want the billboard back turn on "Large status text" in Settings.
 */
fun crossWiseTypography(font: AppFont): Typography {
    val family = familyOf(font)
    fun style(size: Int, weight: FontWeight, line: Int, tracking: Float = 0f) = TextStyle(
        fontFamily = family,
        fontWeight = weight,
        fontSize = size.sp,
        lineHeight = line.sp,
        letterSpacing = tracking.sp,
    )
    return Typography(
        displayLarge = style(52, FontWeight.Bold, 56, -0.5f),   // large-status mode only
        displayMedium = style(34, FontWeight.Bold, 38, -0.3f),  // the phase word, compact mode
        headlineMedium = style(26, FontWeight.Bold, 32),
        titleLarge = style(20, FontWeight.Bold, 26),
        titleMedium = style(17, FontWeight.Bold, 22),
        bodyLarge = style(16, FontWeight.Normal, 22),
        bodyMedium = style(15, FontWeight.Normal, 21),
        labelLarge = style(13, FontWeight.Bold, 17, 0.9f),
        labelMedium = style(12, FontWeight.Normal, 16),
    )
}

@Composable
fun CrossWiseTheme(font: AppFont = AppFont.MODERN, content: @Composable () -> Unit) {
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
        typography = crossWiseTypography(font),
    ) {
        // Surface is what publishes LocalContentColor. Without it every Text that does not name a color is drawn
        // black — on this background, invisible. That was a real bug, not a theoretical one.
        Surface(color = CrossWiseColors.Background, contentColor = CrossWiseColors.OnSurface, content = content)
    }
}
