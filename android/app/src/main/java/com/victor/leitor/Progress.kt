package com.victor.leitor

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import java.text.DateFormatSymbols
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private const val DAY_MS = 86_400_000L

/** A blank [label] is not drawn. */
private data class Bar(val label: String, val value: Int)

@Composable
fun Progress(app: App, modifier: Modifier) {
    val version by app.db.changes.collectAsState()
    val today = localDay()
    // tiles and details count since the start; the chart shows the last seven days
    val stats = remember(version) { app.db.dayStats(0) }
    val streak = remember(version) { app.db.streak() }
    val bars = remember(stats) { bars(stats, today - 6, today) }
    val totals = remember(version) { app.db.totals() }
    val primary = MaterialTheme.colorScheme.primary

    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        ScreenTitle(stringResource(R.string.progress_title))
        LevelCard(totals)
        HabitCard(app, version)
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            StatTile(Icons.Outlined.CalendarToday, primary, stringResource(R.string.reading_days), "${stats.count { it.active }}", Modifier.weight(1f))
            StatTile(Icons.Outlined.LocalFireDepartment, Flame, stringResource(R.string.streak), days(streak.current), Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            StatTile(Icons.Filled.TextFields, primary, stringResource(R.string.translations), "${stats.sumOf { it.translations }}", Modifier.weight(1f))
            StatTile(Icons.AutoMirrored.Filled.MenuBook, MaterialTheme.colorScheme.onSurface, stringResource(R.string.books_read), "${totals.booksCompleted}", Modifier.weight(1f))
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

/** Daily and weekly streaks over a month calendar: goal days filled in amber, other reading days ringed, today outlined. */
@Composable
fun HabitCard(app: App, version: Int) {
    val today = localDay()
    val firstDow = remember { firstDayOfWeek() }
    val streak = remember(version) { app.db.streak() }
    val weeks = remember(version) { WeekStreak.compute(app.db.activeDays(), today, firstDow) }
    var offset by rememberSaveable { mutableIntStateOf(0) }
    val month = remember(offset) { monthAround(today, offset) }
    val stats = remember(version, month) { app.db.dayStats(month.first).filter { it.day < month.first + month.length }.associateBy { it.day } }
    val cells = remember(month, firstDow) { monthCells(month.first, month.length, firstDow) }
    val weekdays = remember(firstDow) { weekdayInitials(firstDow) }

    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder) {
        Column(Modifier.padding(18.dp)) {
            Row {
                HabitStat(
                    Icons.Outlined.LocalFireDepartment, Flame, pluralStringResource(R.plurals.streak_days, streak.current, streak.current),
                    stringResource(R.string.habit_daily), Modifier.weight(1f),
                )
                HabitStat(
                    Icons.Outlined.CalendarMonth, MaterialTheme.colorScheme.primary, pluralStringResource(R.plurals.streak_weeks, weeks.current, weeks.current),
                    stringResource(if (weeks.thisWeek) R.string.habit_week_done else R.string.habit_week_open), Modifier.weight(1f),
                )
            }
            HorizontalDivider(Modifier.padding(vertical = 14.dp), color = MaterialTheme.colorScheme.outlineVariant)
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { offset-- }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(R.string.habit_previous_month)) }
                Text(month.title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                IconButton(onClick = { offset++ }, enabled = offset < 0) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.habit_next_month)) }
            }
            Row(Modifier.padding(top = 4.dp)) {
                weekdays.forEach {
                    Text(it, Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                }
            }
            cells.chunked(7).forEach { week ->
                Row {
                    week.forEach { day -> DayCell(day, day?.let { (it - month.first + 1).toInt() }, day?.let(stats::get), today, Modifier.weight(1f)) }
                    repeat(7 - week.size) { Spacer(Modifier.weight(1f)) }
                }
            }
            Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Legend(Modifier.background(Flame, CircleShape), stringResource(R.string.habit_legend_goal))
                Legend(Modifier.border(1.5.dp, Flame, CircleShape), stringResource(R.string.habit_legend_read))
            }
        }
    }
}

@Composable
private fun HabitStat(icon: ImageVector, tint: Color, value: String, label: String, modifier: Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(38.dp).clip(CircleShape).background(tint.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
            Icon(icon, null, Modifier.size(20.dp), tint = tint)
        }
        Column(Modifier.padding(start = 10.dp)) {
            Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
        }
    }
}

@Composable
private fun DayCell(day: Long?, number: Int?, stat: DayStat?, today: Long, modifier: Modifier) {
    Box(modifier.aspectRatio(1f).padding(3.dp), contentAlignment = Alignment.Center) {
        if (day == null || number == null) return@Box
        val goal = stat?.goalMet == true
        val read = stat?.active == true
        val mark = when {
            goal -> Modifier.background(Flame, CircleShape)
            read -> Modifier.border(1.5.dp, Flame, CircleShape)
            day == today -> Modifier.border(1.5.dp, MaterialTheme.colorScheme.onSurfaceVariant, CircleShape)
            else -> Modifier
        }
        Box(Modifier.fillMaxSize().then(mark), contentAlignment = Alignment.Center) {
            Text(
                "$number",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = if (day == today) FontWeight.Bold else FontWeight.Normal,
                color = when {
                    goal -> MaterialTheme.colorScheme.onTertiary
                    day > today -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f)
                    else -> MaterialTheme.colorScheme.onSurface
                },
            )
        }
    }
}

@Composable
private fun Legend(dot: Modifier, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(12.dp).then(dot))
        Text(label, Modifier.padding(start = 6.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private data class Month(val first: Long, val length: Int, val title: String)

/** The month [offset] months away from the one holding [today] (a local day number). */
private fun monthAround(today: Long, offset: Int): Month {
    val utc = TimeZone.getTimeZone("UTC")
    val cal = Calendar.getInstance(utc).apply {
        timeInMillis = today * DAY_MS
        set(Calendar.DAY_OF_MONTH, 1)
        add(Calendar.MONTH, offset)
    }
    val title = SimpleDateFormat("LLLL yyyy", Locale.getDefault()).apply { timeZone = utc }.format(cal.time)
        .replaceFirstChar { it.titlecase(Locale.getDefault()) }
    return Month(cal.timeInMillis / DAY_MS, cal.getActualMaximum(Calendar.DAY_OF_MONTH), title)
}

/** One letter per weekday, starting at [firstDow] (0 Sunday). */
private fun weekdayInitials(firstDow: Int): List<String> {
    val names = DateFormatSymbols.getInstance().shortWeekdays // 1 Sunday … 7 Saturday
    return (0 until 7).map { names[(firstDow + it) % 7 + 1].take(1).uppercase() }
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
        AchievementGroup.entries.forEach { group ->
            Text(stringResource(group.title), Modifier.padding(top = 4.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Achievement.entries.filter { it.group == group }.chunked(2).forEach { pair ->
                // IntrinsicSize gives both tiles of a row the height of the taller one
                Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    pair.forEach { AchievementTile(it, t, Modifier.weight(1f).fillMaxHeight()) }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

private val Grayscale = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0f) })

@Composable
private fun AchievementTile(a: Achievement, t: Totals, modifier: Modifier) {
    val done = a.unlocked(t)
    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, border = cardBorder, modifier = modifier) {
        Column(Modifier.padding(16.dp).alpha(if (done) 1f else 0.65f)) {
            // a locked one shows its art in gray, with a padlock
            Box {
                Image(painterResource(a.art), null, Modifier.size(72.dp).clip(RoundedCornerShape(16.dp)), colorFilter = if (done) null else Grayscale)
                if (!done) {
                    Box(
                        Modifier.align(Alignment.BottomEnd).offset(6.dp, 6.dp).size(26.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Outlined.Lock, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
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

/** One bar per day from [from] to [today], labelled with its weekday. */
private fun bars(stats: List<DayStat>, from: Long, today: Long): List<Bar> {
    val weekday = SimpleDateFormat("EEE", Locale.getDefault()).apply { timeZone = TimeZone.getTimeZone("UTC") }
    val byDay = stats.associate { it.day to it.translations }
    return (from..today).map { day -> Bar(weekday.format(Date(day * DAY_MS)), byDay[day] ?: 0) }
}
