package com.victor.leitor

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews

/**
 * Home-screen widget: today's streak and reading goal, and a word of the day from the vocabulary. The app refreshes it whenever
 * its data changes; the system also asks every few hours (widget_streak_info.xml), so a new day shows without opening the app.
 */
class StreakWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = render(context, manager, ids)

    companion object {
        /** Tapping the word opens the vocabulary; MainActivity reads this extra. */
        const val EXTRA_OPEN_TAB = "open_tab"

        fun update(ctx: Context) {
            val manager = AppWidgetManager.getInstance(ctx)
            val ids = manager.getAppWidgetIds(ComponentName(ctx, StreakWidget::class.java))
            if (ids.isNotEmpty()) render(ctx, manager, ids)
        }

        private fun render(ctx: Context, manager: AppWidgetManager, ids: IntArray) {
            val app = ctx.applicationContext as App
            val streak = app.db.streak()
            val read = app.db.todayReadingSeconds()
            val goal = app.prefs.dailyGoalMinutes * 60
            val word = wordOfDay(app.db.words(), localDay())
            val views = RemoteViews(ctx.packageName, R.layout.widget_streak).apply {
                setImageViewResource(R.id.widget_flame, if (streak.metToday) R.drawable.streak else R.drawable.streak_inactive)
                setTextViewText(
                    R.id.widget_streak,
                    if (streak.current == 0) ctx.getString(R.string.streak_start)
                    else ctx.getString(R.string.streak_days, ctx.resources.getQuantityString(R.plurals.streak_days, streak.current, streak.current)),
                )
                setTextViewText(
                    R.id.widget_goal,
                    if (streak.metToday) ctx.getString(R.string.goal_met_today) else ctx.getString(R.string.goal_today_progress, read / 60, goal / 60),
                )
                setProgressBar(R.id.widget_progress, 100, if (streak.metToday) 100 else (read * 100 / goal.coerceAtLeast(1)).coerceIn(0, 100), false)
                setTextViewText(R.id.widget_word, word?.original ?: ctx.getString(R.string.widget_no_words))
                setTextViewText(R.id.widget_meaning, word?.translated.orEmpty())
                setViewVisibility(R.id.widget_meaning, if (word == null) View.GONE else View.VISIBLE)
                setOnClickPendingIntent(R.id.widget_root, open(ctx, tab = null))
                setOnClickPendingIntent(R.id.widget_word_box, open(ctx, tab = 1))
            }
            manager.updateAppWidget(ids, views)
        }

        private fun open(ctx: Context, tab: Int?): PendingIntent {
            val intent = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            tab?.let { intent.putExtra(EXTRA_OPEN_TAB, it) }
            return PendingIntent.getActivity(ctx, tab ?: 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
    }
}
