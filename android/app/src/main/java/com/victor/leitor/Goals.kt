@file:OptIn(ExperimentalMaterial3Api::class)

package com.victor.leitor

import androidx.compose.ui.res.stringResource
import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

val GOAL_OPTIONS = listOf(3, 5, 10, 15, 20, 30)

/** Streak goals in days; each one reached (by the longest streak) evolves the flame. */
val STREAK_GOALS = listOf(7, 14, 30)

fun flameLevel(longest: Int) = STREAK_GOALS.count { longest >= it }

// the aura behind the flame for each level: none, amber, blue, purple
private val FLAME_AURAS = listOf(Color.Transparent, Color(0x55F59E0B), Color(0x5538BDF8), Color(0x66A855F7))

@Composable
private fun EvolvedFlame(lit: Boolean, longest: Int, size: Int) {
    Box(Modifier.size((size + 10).dp).clip(CircleShape).background(FLAME_AURAS[flameLevel(longest)]), contentAlignment = Alignment.Center) {
        Image(painterResource(if (lit) R.drawable.streak else R.drawable.streak_inactive), null, Modifier.size(size.dp))
    }
}

@Composable
fun days(n: Int) = if (n == 1) stringResource(R.string.one_day) else stringResource(R.string.n_days, n)

@Composable
fun StreakCard(app: App, version: Int, onClick: () -> Unit) {
    val streak = remember(version) { app.db.streak() }
    val read = remember(version) { app.db.todayReadingSeconds() }
    val goal = app.prefs.dailyGoalMinutes * 60
    Surface(
        onClick = onClick, shape = CardShape, color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder, modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            EvolvedFlame(streak.metToday, streak.longest, 40)
            Column(Modifier.weight(1f).padding(start = 14.dp)) {
                Text(
                    if (streak.current == 0) stringResource(R.string.streak_start) else stringResource(R.string.streak_days, days(streak.current)),
                    style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                )
                Text(
                    if (streak.metToday) stringResource(R.string.goal_met_today) else stringResource(R.string.goal_today_progress, read / 60, goal / 60),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (app.prefs.streakGoal > 0 && streak.current > 0) {
                    Text(
                        stringResource(R.string.streak_goal_progress, streak.current, app.prefs.streakGoal),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                streak.recovery?.let {
                    Text(
                        stringResource(R.string.streak_recovery, days(it.lost), it.done, Streak.RECOVER_DAYS),
                        style = MaterialTheme.typography.bodySmall, color = Flame, fontWeight = FontWeight.SemiBold,
                    )
                }
                Spacer(Modifier.height(8.dp))
                Box(Modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f))) {
                    val fraction = if (streak.metToday) 1f else (read.toFloat() / goal).coerceIn(0f, 1f)
                    if (fraction > 0f) Box(Modifier.fillMaxWidth(fraction).fillMaxHeight().clip(CircleShape).background(Flame))
                }
            }
            if (streak.shields > 0) Text("🛡️${streak.shields}", Modifier.padding(start = 12.dp), style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
fun GoalSheet(app: App, version: Int, onDismiss: () -> Unit) {
    val streak = remember(version) { app.db.streak() }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                EvolvedFlame(true, streak.longest, 36)
                Text(stringResource(R.string.streak), Modifier.padding(start = 10.dp), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            }
            Text(
                stringResource(R.string.streak_rules, app.prefs.dailyGoalMinutes),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                stringResource(R.string.streak_summary, days(streak.current), days(streak.longest), streak.shields),
                style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
            )
            Text(stringResource(R.string.streak_goal), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.streak_goal_hint, flameLevel(streak.longest), STREAK_GOALS.size), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Pills(STREAK_GOALS.map { days(it) }, STREAK_GOALS.indexOf(app.prefs.streakGoal)) { app.prefs.streakGoal = STREAK_GOALS[it] }
            Text(stringResource(R.string.daily_goal), style = MaterialTheme.typography.titleMedium)
            Pills(GOAL_OPTIONS.map { stringResource(R.string.n_min, it) }, GOAL_OPTIONS.indexOf(app.prefs.dailyGoalMinutes)) { app.prefs.dailyGoalMinutes = GOAL_OPTIONS[it] }
        }
    }
}

@Composable
fun rememberReminderSetter(app: App): (Int) -> Unit {
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    return { choice ->
        app.prefs.reminder = choice
        Reminders.schedule(app)
        if (ReminderTime.entries[choice].hour != null && Build.VERSION.SDK_INT >= 33) permission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}
