package com.crosswise.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.crosswise.R
import com.crosswise.perception.SegClasses

/**
 * Paints the segmentation mask over the camera, stretched to the preview exactly as the frame was.
 *
 * Drawn only while a segmentation model is loaded — a box model has no mask, and the view must stay clear.
 */
@Composable
fun SegmentationOverlay(mask: Bitmap?, modifier: Modifier = Modifier) {
    if (mask == null || mask.isRecycled) return
    val image = mask.asImageBitmap()
    Canvas(modifier) {
        drawImage(
            image = image,
            srcOffset = IntOffset.Zero,
            srcSize = IntSize(image.width, image.height),
            dstOffset = IntOffset.Zero,
            dstSize = IntSize(size.width.toInt(), size.height.toInt()),
        )
    }
}

/**
 * The colour key for those masks. Without it the overlay is decoration: the legend is what turns a wash of colour
 * into "that purple area is road, that yellow strip is a step".
 */
@Composable
fun SegmentationLegend(modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Dimens.radiusCard))
            .background(CrossWiseColors.Glass)
            .padding(Dimens.cardPadding)
            .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(Dimens.gapSmall / 2),
    ) {
        Text(
            stringResource(R.string.seg_legend).uppercase(),
            style = MaterialTheme.typography.labelLarge,
            color = CrossWiseColors.Accent,
        )
        // Two columns: sixteen classes in a single list would push the controls off the screen.
        SegClasses.LABELS.chunked(2).forEachIndexed { rowIndex, pair ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Dimens.gapSmall)) {
                pair.forEachIndexed { columnIndex, label ->
                    val index = rowIndex * 2 + columnIndex
                    Row(
                        Modifier.weight(1f),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Dimens.gapSmall),
                    ) {
                        Box(
                            Modifier
                                .size(14.dp)
                                .clip(RoundedCornerShape(3.dp))
                                .background(Color(SegClasses.COLORS[index])),
                        )
                        Text(label, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}
