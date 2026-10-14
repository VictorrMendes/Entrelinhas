package com.victor.leitor

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import java.util.Calendar
import kotlin.math.ceil

object Reminders {
    private const val CHANNEL = "reading-reminder"

    fun schedule(ctx: Context) {
        val app = ctx.applicationContext as App
        val alarms = ctx.getSystemService(AlarmManager::class.java)
        val pending = PendingIntent.getBroadcast(
            ctx, 0, Intent(ctx, ReminderReceiver::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        alarms.cancel(pending)
        val hour = ReminderTime.entries.getOrNull(app.prefs.reminder)?.hour ?: return
        val first = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            if (timeInMillis <= System.currentTimeMillis()) add(Calendar.DAY_OF_YEAR, 1)
        }
        // inexact: the system batches it with other alarms, which is fine for a reading nudge and needs no special permission
        alarms.setInexactRepeating(AlarmManager.RTC_WAKEUP, first.timeInMillis, AlarmManager.INTERVAL_DAY, pending)
    }

    fun notifyIfNeeded(ctx: Context) {
        val app = ctx.applicationContext as App
        val goal = app.prefs.dailyGoalMinutes * 60
        val read = app.db.todayReadingSeconds()
        if (read >= goal || ReminderTime.entries.getOrNull(app.prefs.reminder)?.hour == null) return
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val manager = ctx.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, ctx.getString(R.string.reminder_channel), NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = ctx.getString(R.string.reminder_channel_description)
                },
            )
        }
        val (title, body) = message(ctx, localDay(), app.db.streak().current, ceil((goal - read) / 60.0).toInt())
        val open = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        manager.notify(
            1,
            NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_book)
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(open)
                .setAutoCancel(true)
                .build(),
        )
    }

    private fun message(ctx: Context, day: Long, streak: Int, minutesLeft: Int): Pair<String, String> {
        val messages = buildList {
            if (streak > 0) {
                val days = if (streak == 1) ctx.getString(R.string.one_day) else ctx.getString(R.string.n_days, streak)
                add(ctx.getString(R.string.reminder_streak_title, days) to ctx.getString(R.string.reminder_streak_text, minutesLeft))
            }
            add(ctx.getString(R.string.reminder_time_title) to ctx.getString(R.string.reminder_time_text, minutesLeft))
            add(ctx.getString(R.string.reminder_quick_title) to ctx.getString(R.string.reminder_quick_text, minutesLeft))
            add(ctx.getString(R.string.reminder_vocabulary_title) to ctx.getString(R.string.reminder_vocabulary_text))
        }
        return messages[(day % messages.size).toInt()]
    }
}

// Alarms don't survive a reboot, so BOOT_COMPLETED schedules it again.
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) Reminders.schedule(ctx) else Reminders.notifyIfNeeded(ctx)
    }
}
