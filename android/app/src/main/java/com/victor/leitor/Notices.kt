package com.victor.leitor

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarData
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarVisuals
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow

enum class NoticeKind { INFO, SUCCESS, ERROR }

/** What the action button of a notice does; navigation is resolved by the screen that shows the notice. */
sealed interface NoticeAction {
    data class OpenBook(val id: Long) : NoticeAction
    data object OpenVocabulary : NoticeAction
    data object OpenProgress : NoticeAction
    class Run(val block: () -> Unit) : NoticeAction
}

class Notice(
    override val message: String,
    val kind: NoticeKind = NoticeKind.INFO,
    override val actionLabel: String? = null,
    val action: NoticeAction? = null,
) : SnackbarVisuals {
    override val withDismissAction = false
    override val duration = if (action != null) SnackbarDuration.Long else SnackbarDuration.Short
}

/**
 * App-wide queue, so code without a screen (imports, sync, the update check) can show notices too. A channel keeps what is
 * sent before the screen starts listening, which a SharedFlow would drop.
 */
class Notices {
    private val queue = Channel<Notice>(capacity = 8, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val events = queue.receiveAsFlow()

    fun show(notice: Notice) {
        queue.trySend(notice)
    }
}

@Composable
fun NoticeBar(data: SnackbarData) {
    val notice = data.visuals as? Notice
    val (icon, tint) = when (notice?.kind) {
        NoticeKind.SUCCESS -> Icons.Outlined.CheckCircle to Success
        NoticeKind.ERROR -> Icons.Outlined.ErrorOutline to MaterialTheme.colorScheme.error
        else -> Icons.Outlined.Info to MaterialTheme.colorScheme.primary
    }
    Surface(
        Modifier.padding(horizontal = 16.dp),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.inverseSurface,
        contentColor = MaterialTheme.colorScheme.inverseOnSurface,
        shadowElevation = 6.dp,
    ) {
        Row(Modifier.padding(start = 16.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(22.dp), tint = tint)
            Spacer(Modifier.width(12.dp))
            Text(data.visuals.message, Modifier.weight(1f).padding(vertical = 8.dp), style = MaterialTheme.typography.bodyMedium)
            data.visuals.actionLabel?.let { label ->
                TextButton(onClick = data::performAction) { Text(label, color = MaterialTheme.colorScheme.inversePrimary) }
            }
        }
    }
}
