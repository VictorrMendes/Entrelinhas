package com.victor.leitor

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.outlined.FormatQuote
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * "Ouvir": reads the saved words aloud one after another (the word, its meaning and, when asked, the example sentence),
 * due words first, so the list can be heard with the phone in a pocket. [ListenService] keeps it going with the screen off.
 */
class ListenPlayer(private val app: App) {
    var words by mutableStateOf<List<Word>>(emptyList())
        private set
    var index by mutableIntStateOf(0)
        private set
    var playing by mutableStateOf(false)
        private set

    /** The meaning shows once it is being said, so the listener gets a moment to recall it. */
    var showMeaning by mutableStateOf(false)
        private set
    private val scope = MainScope()
    private var job: Job? = null

    val current get() = words.getOrNull(index)

    fun load() {
        if (playing) return
        words = (app.db.dueWords() + app.db.words()).distinctBy { it.id }
        index = 0
        showMeaning = false
    }

    fun play() {
        if (words.isEmpty()) return
        if (index >= words.size) index = 0
        playing = true
        if (ListenService.running) ListenService.update(app) else ListenService.start(app)
        job?.cancel()
        job = scope.launch { readFromCurrent() }
    }

    fun pause() {
        playing = false
        job?.cancel()
        app.speech.stop()
        ListenService.update(app)
    }

    fun toggle() = if (playing) pause() else play()

    fun next() = move(+1)

    fun previous() = move(-1)

    fun stop() {
        pause()
        ListenService.stop(app)
    }

    private fun move(by: Int) {
        if (words.isEmpty()) return
        index = (index + by).coerceIn(0, words.lastIndex)
        showMeaning = false
        if (playing) play() else ListenService.update(app)
    }

    private suspend fun readFromCurrent() {
        while (true) {
            val w = words.getOrNull(index) ?: break
            showMeaning = false
            ListenService.update(app)
            val rate = app.prefs.speechRate
            if (!app.speech.sayAndWait(w.original, w.source, rate)) {
                app.notices.show(Notice(app.getString(R.string.install_voice, langName(w.source)), NoticeKind.ERROR))
                break
            }
            delay(PAUSE_BEFORE_MEANING_MS)
            showMeaning = true
            ListenService.update(app)
            app.speech.sayAndWait(w.translated, w.target.ifEmpty { app.prefs.defaultTarget }, rate)
            if (app.prefs.listenExamples) {
                w.example?.let {
                    delay(PAUSE_BEFORE_EXAMPLE_MS)
                    app.speech.sayAndWait(it, w.source, rate)
                }
            }
            delay(PAUSE_BETWEEN_WORDS_MS)
            if (index >= words.lastIndex) break
            index++
        }
        playing = false
        ListenService.update(app)
    }

    private companion object {
        const val PAUSE_BEFORE_MEANING_MS = 900L
        const val PAUSE_BEFORE_EXAMPLE_MS = 500L
        const val PAUSE_BETWEEN_WORDS_MS = 1300L
    }
}

/**
 * Keeps "Ouvir" playing with the screen off: a media foreground service with a partial wake lock (the pauses between
 * words would otherwise stretch while the CPU sleeps) and a notification with pause, next and stop.
 */
class ListenService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        wakeLock = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Entrelinhas:listen")
            .apply { acquire(MAX_PLAY_MS) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val player = (application as App).listen
        val shown = notification(this, player)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, shown, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(NOTIFICATION_ID, shown)
        when (intent?.action) {
            ACTION_TOGGLE -> player.toggle()
            ACTION_NEXT -> player.next()
            ACTION_STOP -> player.stop()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        wakeLock?.takeIf { it.isHeld }?.release()
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "listen"
        private const val NOTIFICATION_ID = 7
        private const val ACTION_TOGGLE = "toggle"
        private const val ACTION_NEXT = "next"
        private const val ACTION_STOP = "stop"
        private const val MAX_PLAY_MS = 3 * 3600_000L

        @Volatile
        var running = false
            private set

        fun start(ctx: Context) = ContextCompat.startForegroundService(ctx, Intent(ctx, ListenService::class.java))

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, ListenService::class.java))
        }

        /** Refreshes the notification while the service runs. */
        fun update(ctx: Context) {
            if (!running) return
            val manager = NotificationManagerCompat.from(ctx)
            if (manager.areNotificationsEnabled()) {
                runCatching { manager.notify(NOTIFICATION_ID, notification(ctx, (ctx.applicationContext as App).listen)) }
            }
        }

        private fun notification(ctx: Context, player: ListenPlayer): android.app.Notification {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(
                    NotificationChannel(CHANNEL, ctx.getString(R.string.listen_channel), NotificationManager.IMPORTANCE_LOW),
                )
            }
            fun action(name: String, code: Int) = PendingIntent.getService(
                ctx, code, Intent(ctx, ListenService::class.java).setAction(name), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val open = PendingIntent.getActivity(
                ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE,
            )
            val word = player.current
            return NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_book)
                .setContentTitle(ctx.getString(R.string.listen_progress, player.index + 1, player.words.size))
                .setContentText(word?.let { "${it.original} → ${it.translated}" })
                .setContentIntent(open)
                .setOngoing(player.playing)
                .setSilent(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .addAction(0, ctx.getString(if (player.playing) R.string.listen_pause else R.string.listen_play), action(ACTION_TOGGLE, 1))
                .addAction(0, ctx.getString(R.string.listen_next), action(ACTION_NEXT, 2))
                .addAction(0, ctx.getString(R.string.listen_stop), action(ACTION_STOP, 3))
                .build()
        }
    }
}

@Composable
fun ListenMode(app: App, onClose: () -> Unit) {
    val player = app.listen
    val prefs = app.prefs
    // leaving the screen stops the reading; turning the screen off doesn't
    DisposableEffect(Unit) {
        player.load()
        onDispose { player.stop() }
    }
    val word = player.current

    Column(Modifier.fillMaxSize()) {
        StudyTopBar(stringResource(R.string.mode_listen), onClose)
        StudyProgress(if (word == null) 0 else player.index + 1, player.words.size)
        Text(
            stringResource(R.string.listen_progress, player.index + 1, player.words.size), Modifier.fillMaxWidth().padding(top = 10.dp),
            style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
        )
        Surface(
            shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth().weight(1f).padding(20.dp),
        ) {
            Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                if (word != null) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(word.original, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                        Text(
                            if (player.showMeaning) word.translated else "…", Modifier.padding(top = 12.dp),
                            style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.primary, textAlign = TextAlign.Center,
                        )
                        if (player.showMeaning && prefs.listenExamples) {
                            word.example?.let {
                                Text(
                                    "“$it”", Modifier.padding(top = 20.dp), style = MaterialTheme.typography.bodyLarge, fontStyle = FontStyle.Italic,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
                                )
                            }
                        }
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)) {
            FilterChip(
                selected = prefs.listenExamples, onClick = { prefs.listenExamples = !prefs.listenExamples },
                label = { Text(stringResource(R.string.listen_examples)) }, leadingIcon = { Icon(Icons.Outlined.FormatQuote, null) },
            )
            FilterChip(
                selected = false,
                onClick = { prefs.speechRate = SPEECH_RATES[(SPEECH_RATES.indexOf(prefs.speechRate) + 1) % SPEECH_RATES.size] },
                label = { Text(rateLabel(prefs.speechRate)) }, leadingIcon = { Icon(Icons.Outlined.Speed, null) },
            )
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 20.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = player::previous, Modifier.size(56.dp)) { Icon(Icons.Filled.SkipPrevious, stringResource(R.string.listen_previous), Modifier.size(32.dp)) }
            FilledIconButton(onClick = player::toggle, Modifier.size(80.dp)) {
                Icon(
                    if (player.playing) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                    stringResource(if (player.playing) R.string.listen_pause else R.string.listen_play), Modifier.size(40.dp),
                )
            }
            IconButton(onClick = player::next, Modifier.size(56.dp)) { Icon(Icons.Filled.SkipNext, stringResource(R.string.listen_next), Modifier.size(32.dp)) }
        }
        Text(
            stringResource(R.string.listen_hint), Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 16.dp),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
        )
    }
}
