package com.victor.leitor

import androidx.annotation.StringRes
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private const val DAY_MS = 86_400_000L

private enum class Range(@StringRes val label: Int, val days: Int, val monthly: Boolean) {
    WEEK(R.string.range_week, 7, false),
    MONTH(R.string.range_month, 30, false),
    HALF_YEAR(R.string.range_half_year, 182, true),
    YEAR(R.string.range_year, 365, true),
}

/** A blank [label] is not drawn. */
private data class Bar(val label: String, val value: Int)

@Composable
fun Progress(app: App, modifier: Modifier) {
    val version by app.db.changes.collectAsState()
    var range by rememberSaveable { mutableStateOf(Range.WEEK) }
    val today = localDay()
    val from = today - range.days + 1
    val stats = remember(version, range) { app.db.dayStats(from) }
    val streak = remember(version) { app.db.streak() }
    val booksRead = remember(version, range) { app.db.booksCompletedSince(dayStartMillis(from)) }
    val bars = remember(stats, range) { bars(stats, from, today, range) }
    val totals = remember(version) { app.db.totals() }
    val primary = MaterialTheme.colorScheme.primary

    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        ScreenTitle(stringResource(R.string.progress_title))
        LevelCard(totals)
        Segmented(Range.entries.map { stringResource(it.label) }, range.ordinal) { range = Range.entries[it] }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            StatTile(Icons.Outlined.CalendarToday, primary, stringResource(R.string.reading_days), "${stats.count { it.active }}", Modifier.weight(1f))
            StatTile(Icons.Outlined.LocalFireDepartment, Flame, stringResource(R.string.streak), days(streak.current), Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            StatTile(Icons.Filled.TextFields, primary, stringResource(R.string.translations), "${stats.sumOf { it.translations }}", Modifier.weight(1f))
            StatTile(Icons.AutoMirrored.Filled.MenuBook, MaterialTheme.colorScheme.onSurface, stringResource(R.string.books_read), "$booksRead", Modifier.weight(1f))
        }
        Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder) {
            Column(Modifier.padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.activity_summary), Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Box(Modifier.size(10.dp).clip(CircleShape).background(primary))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.translations), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.height(20.dp))
                Text(stringResource(R.string.translation_count), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(8.dp))
                BarChart(bars, Modifier.fillMaxWidth())
            }
        }
        Text(stringResource(R.string.details), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder) {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) {
                DetailText(stringResource(R.string.reading_time), stringResource(R.string.n_min, stats.sumOf { it.readingSeconds } / 60))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                DetailText(stringResource(R.string.longest_streak), days(streak.longest))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Detail(stringResource(R.string.words_translated), stats.sumOf { it.words })
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Detail(stringResource(R.string.paragraphs_translated), stats.sumOf { it.paragraphs })
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
        Achievements(totals)
        Spacer(Modifier.height(8.dp))
    }
}

/** Lifetime XP and the level it reaches; the bar fills toward the next level. */
@Composable
fun LevelCard(t: Totals) {
    val level = Levels.of(t.xp)
    val from = Levels.start(level)
    val to = Levels.start(level + 1)
    val onPrimary = MaterialTheme.colorScheme.onPrimary
    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.primary, contentColor = onPrimary) {
        Column(Modifier.fillMaxWidth().padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.EmojiEvents, null, tint = Flame)
                Text(stringResource(R.string.level_n, level), Modifier.weight(1f).padding(start = 10.dp), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(stringResource(R.string.xp_n, t.xp), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.height(14.dp))
            Box(Modifier.fillMaxWidth().height(8.dp).clip(CircleShape).background(onPrimary.copy(alpha = 0.25f))) {
                Box(Modifier.fillMaxWidth((t.xp - from).toFloat() / (to - from)).fillMaxHeight().clip(CircleShape).background(onPrimary))
            }
            Spacer(Modifier.height(8.dp))
            Text(stringResource(R.string.xp_to_next, to - t.xp, level + 1), style = MaterialTheme.typography.bodySmall, color = onPrimary.copy(alpha = 0.85f))
        }
    }
}

@Composable
fun Achievements(t: Totals) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.achievements), Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(
                "${Achievement.entries.count { it.unlocked(t) }}/${Achievement.entries.size}",
                style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(stringResource(R.string.xp_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Achievement.entries.chunked(2).forEach { pair ->
            // IntrinsicSize gives both tiles of a row the height of the taller one
            Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                pair.forEach { AchievementTile(it, t, Modifier.weight(1f).fillMaxHeight()) }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun AchievementTile(a: Achievement, t: Totals, modifier: Modifier) {
    val done = a.unlocked(t)
    val tint = if (done) Flame else MaterialTheme.colorScheme.onSurfaceVariant
    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder, modifier = modifier) {
        Column(Modifier.padding(16.dp).alpha(if (done) 1f else 0.65f)) {
            Box(Modifier.size(40.dp).clip(CircleShape).background(tint.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
                Icon(if (done) Icons.Outlined.EmojiEvents else Icons.Outlined.Lock, null, Modifier.size(22.dp), tint = tint)
            }
            Spacer(Modifier.height(10.dp))
            Text(stringResource(a.title), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(stringResource(a.text), Modifier.padding(top = 2.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (!done) {
                Text(
                    "${minOf(a.value(t), a.target)}/${a.target}", Modifier.padding(top = 6.dp),
                    style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}

@Composable
private fun Segmented(labels: List<String>, selected: Int, onSelect: (Int) -> Unit) {
    val track = lerp(MaterialTheme.colorScheme.background, MaterialTheme.colorScheme.surfaceVariant, 0.5f)
    Row(Modifier.fillMaxWidth().clip(CircleShape).background(track).padding(4.dp)) {
        labels.forEachIndexed { i, label ->
            val active = i == selected
            Box(
                Modifier.weight(1f).height(44.dp).clip(CircleShape)
                    .background(if (active) MaterialTheme.colorScheme.primary else Color.Transparent)
                    .selectable(selected = active, role = Role.Tab) { onSelect(i) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = if (active) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

@Composable
private fun StatTile(icon: ImageVector, tint: Color, label: String, value: String, modifier: Modifier) {
    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder, modifier = modifier.height(140.dp)) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(38.dp).clip(CircleShape).background(tint.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
                    Icon(icon, null, Modifier.size(20.dp), tint = tint)
                }
                Spacer(Modifier.width(12.dp))
                Text(label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 2)
            }
            Spacer(Modifier.height(6.dp))
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun Detail(label: String, value: Int) = DetailText(label, "$value")

@Composable
private fun DetailText(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Text(value, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun BarChart(bars: List<Bar>, modifier: Modifier) {
    var selected by remember(bars) { mutableStateOf<Int?>(null) }
    val total = bars.sumOf { it.value }
    val max = niceMax(bars.maxOfOrNull { it.value } ?: 0)
    val step = if (max <= 5) 1 else max / 5
    val barColor = MaterialTheme.colorScheme.primary
    val gridColor = MaterialTheme.colorScheme.outlineVariant
    val labelStyle = MaterialTheme.typography.labelMedium.copy(color = MaterialTheme.colorScheme.onSurfaceVariant)
    val valueStyle = MaterialTheme.typography.labelLarge.copy(color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
    val measurer = rememberTextMeasurer()
    val description = stringResource(R.string.chart_description, total)

    Canvas(
        modifier.height(200.dp)
            .semantics { contentDescription = description }
            .pointerInput(bars) {
                detectTapGestures { pos ->
                    val axis = 28.dp.toPx()
                    val i = ((pos.x - axis) / ((size.width - axis) / bars.size.coerceAtLeast(1))).toInt()
                    selected = i.takeIf { it in bars.indices && it != selected }
                }
            },
    ) {
        val axis = 28.dp.toPx()
        val top = 12.dp.toPx()
        val baseline = size.height - 24.dp.toPx()
        val slot = (size.width - axis) / bars.size.coerceAtLeast(1)
        val barWidth = minOf(40.dp.toPx(), slot * 0.6f)
        val radius = minOf(6.dp.toPx(), barWidth / 2)

        var tick = 0
        while (tick <= max) {
            val y = baseline - (baseline - top) * tick / max
            drawLine(gridColor, Offset(axis, y), Offset(size.width, y), 1.dp.toPx())
            val layout = measurer.measure("$tick", labelStyle)
            drawText(layout, topLeft = Offset(axis - layout.size.width - 8.dp.toPx(), y - layout.size.height / 2))
            tick += step
        }

        bars.forEachIndexed { i, bar ->
            val cx = axis + slot * i + slot / 2
            if (bar.value > 0) {
                val h = (baseline - top) * bar.value / max
                val path = Path().apply {
                    addRoundRect(
                        RoundRect(
                            left = cx - barWidth / 2, top = baseline - h, right = cx + barWidth / 2, bottom = baseline,
                            topLeftCornerRadius = CornerRadius(radius), topRightCornerRadius = CornerRadius(radius),
                            bottomRightCornerRadius = CornerRadius.Zero, bottomLeftCornerRadius = CornerRadius.Zero,
                        ),
                    )
                }
                drawPath(path, barColor, alpha = if (selected == null || selected == i) 1f else 0.35f)
                if (selected == i) {
                    val v = measurer.measure("${bar.value}", valueStyle)
                    drawText(v, topLeft = Offset(cx - v.size.width / 2, (baseline - h - v.size.height - 4.dp.toPx()).coerceAtLeast(0f)))
                }
            }
            if (bar.label.isNotEmpty()) {
                val layout = measurer.measure(bar.label, labelStyle)
                val x = (cx - layout.size.width / 2).coerceIn(0f, size.width - layout.size.width)
                drawText(layout, topLeft = Offset(x, baseline + 6.dp.toPx()))
            }
        }
    }
}

/** Rounds up to 1/2/5 × 10ⁿ so the gridlines carry clean numbers. */
private fun niceMax(v: Int): Int {
    if (v <= 1) return 1
    var p = 1
    while (p * 10 < v) p *= 10
    return listOf(1, 2, 5, 10).first { it * p >= v } * p
}

private fun dayStartMillis(day: Long): Long = day * DAY_MS - TimeZone.getDefault().getOffset(day * DAY_MS)

private fun bars(stats: List<DayStat>, from: Long, today: Long, range: Range): List<Bar> {
    val utc = TimeZone.getTimeZone("UTC")
    fun fmt(pattern: String, day: Long) = SimpleDateFormat(pattern, Locale.getDefault()).apply { timeZone = utc }.format(Date(day * DAY_MS))
    val byDay = stats.associate { it.day to it.translations }
    if (!range.monthly) {
        return (from..today).mapIndexed { i, day ->
            // 7 days: every weekday labelled; 30 days: every 5th day plus today, so labels never collide
            val label = when {
                range == Range.WEEK -> fmt("EEE", day)
                i % 5 == 0 || day == today -> fmt("d", day)
                else -> ""
            }
            Bar(label, byDay[day] ?: 0)
        }
    }
    val cal = Calendar.getInstance(utc)
    val months = LinkedHashMap<Int, Pair<Long, Int>>() // year*12+month -> (first day seen, sum)
    for (day in from..today) {
        cal.timeInMillis = day * DAY_MS
        val key = cal.get(Calendar.YEAR) * 12 + cal.get(Calendar.MONTH)
        val (first, sum) = months[key] ?: (day to 0)
        months[key] = first to sum + (byDay[day] ?: 0)
    }
    return months.values.map { (first, sum) -> Bar(fmt("MMM", first), sum) }
}
