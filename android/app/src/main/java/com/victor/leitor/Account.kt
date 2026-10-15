package com.victor.leitor

import android.text.format.DateUtils
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.material.icons.outlined.Pin
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.io.IOException
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.launch

@Composable
fun AccountSection(app: App) {
    var signIn by remember { mutableStateOf(false) }
    Section(stringResource(R.string.account_section))
    val email = app.prefs.accountEmail
    if (email == null) {
        SettingCard(stringResource(R.string.sign_in_or_create), subtitle = stringResource(R.string.sign_in_or_create_hint)) { signIn = true }
    } else {
        Surface(
            shape = CardShape, color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface,
            border = cardBorder, modifier = Modifier.fillMaxWidth(),
        ) {
            Row(Modifier.padding(start = 16.dp, end = 8.dp, top = 14.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                val name = app.prefs.accountName
                Box(Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
                    Text((name ?: email).take(1).uppercase(), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
                }
                Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                    Text(name ?: email, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (name != null) {
                        Text(email, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Text(syncStatus(app), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                    if (app.syncing) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                    else IconButton(onClick = { app.sync() }) { Icon(Icons.Outlined.Sync, stringResource(R.string.sync_now), tint = MaterialTheme.colorScheme.primary) }
                }
            }
        }
    }
    if (signIn) SignInSheet(app) { signIn = false }
}

@Composable
private fun syncStatus(app: App): String {
    val last = app.prefs.lastSync
    return when {
        app.syncing -> stringResource(R.string.syncing)
        last == 0L -> stringResource(R.string.not_synced_yet)
        DateUtils.isToday(last) -> stringResource(R.string.synced_today, DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(last)))
        else -> stringResource(R.string.synced_on, DateFormat.getDateInstance(DateFormat.SHORT).format(Date(last)))
    }
}

@Composable
fun SignOutButton(app: App) {
    if (app.prefs.accountEmail == null) return
    var confirm by remember { mutableStateOf(false) }
    TextButton(onClick = { confirm = true }, Modifier.fillMaxWidth().padding(top = 16.dp)) {
        Text(stringResource(R.string.sign_out), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.titleMedium)
    }
    if (confirm) Confirm(stringResource(R.string.sign_out_title), stringResource(R.string.sign_out_text), { confirm = false }, stringResource(R.string.sign_out_action)) {
        app.backend.signOut()
    }
}

/** Same limit as the backend's signup validation. */
private const val MAX_NAME = 40

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignInSheet(app: App, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var create by remember { mutableStateOf(false) }
    var resetting by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<Int?>(null) }
    val emailFocus = remember { FocusRequester() }
    val passwordFocus = remember { FocusRequester() }
    val ready = !busy && email.isNotBlank() && password.isNotEmpty() && (!create || name.isNotBlank())

    fun submit() {
        if (!ready) return
        busy = true
        error = null
        scope.launch {
            try {
                app.backend.signIn(email.trim(), password, name.trim().takeIf { create })
                app.sync()
                onDismiss()
            } catch (e: ApiException) {
                error = when (e.code) {
                    "INVALID_CREDENTIALS" -> R.string.error_credentials
                    "EMAIL_TAKEN" -> R.string.error_email_taken
                    "TOO_MANY_ATTEMPTS", "TOO_MANY_REQUESTS" -> R.string.error_too_many_attempts
                    "INVALID_REQUEST" -> if (create) R.string.error_invalid_signup else R.string.error_invalid_credentials_format
                    else -> R.string.error_sign_in
                }
            } catch (e: IOException) {
                error = R.string.error_no_connection
            } finally {
                busy = false
            }
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        // the sheet is its own window: its keyboard controller, not the screen's, closes the keyboard
        val keyboard = LocalSoftwareKeyboardController.current
        val send = {
            keyboard?.hide() // so the result (error or success) isn't hidden behind it
            submit()
        }
        Column(
            Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Image(painterResource(R.drawable.mascot), null, Modifier.size(88.dp))
            if (resetting) {
                PasswordReset(app, email, onBack = { resetting = false }, onDone = onDismiss)
                return@Column
            }
            Text(
                stringResource(if (create) R.string.create_title else R.string.sign_in_title),
                Modifier.padding(top = 8.dp), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                stringResource(R.string.sign_in_subtitle),
                Modifier.padding(top = 4.dp, bottom = 20.dp), style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
            )
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                listOf(R.string.sign_in, R.string.create_account).forEachIndexed { i, label ->
                    SegmentedButton(
                        selected = create == (i == 1),
                        onClick = { create = i == 1; error = null },
                        shape = SegmentedButtonDefaults.itemShape(i, 2),
                        icon = {},
                    ) { Text(stringResource(label)) }
                }
            }
            Spacer(Modifier.height(16.dp))
            if (create) {
                OutlinedTextField(
                    name, { name = it.take(MAX_NAME) }, Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.name)) },
                    leadingIcon = { Icon(Icons.Outlined.Person, null) },
                    singleLine = true, shape = RoundedCornerShape(14.dp),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { emailFocus.requestFocus() }),
                    supportingText = { Text(stringResource(R.string.name_hint)) },
                )
                Spacer(Modifier.height(4.dp))
            }
            OutlinedTextField(
                email, { email = it }, Modifier.fillMaxWidth().focusRequester(emailFocus),
                label = { Text(stringResource(R.string.email)) },
                leadingIcon = { Icon(Icons.Outlined.Email, null) },
                singleLine = true, shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { passwordFocus.requestFocus() }),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                password, { password = it }, Modifier.fillMaxWidth().focusRequester(passwordFocus),
                label = { Text(stringResource(R.string.password)) },
                leadingIcon = { Icon(Icons.Outlined.Lock, null) },
                trailingIcon = {
                    IconButton(onClick = { showPassword = !showPassword }) {
                        Icon(
                            if (showPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                            stringResource(if (showPassword) R.string.hide_password else R.string.show_password),
                        )
                    }
                },
                singleLine = true, shape = RoundedCornerShape(14.dp),
                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { send() }),
                supportingText = if (create) ({ Text(stringResource(R.string.password_hint)) }) else null,
            )
            if (!create) {
                TextButton(onClick = { resetting = true; error = null }, Modifier.align(Alignment.End)) { Text(stringResource(R.string.forgot_password)) }
            }
            error?.let {
                Text(
                    stringResource(it),
                    Modifier.fillMaxWidth().padding(top = 12.dp).clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.errorContainer).padding(horizontal = 14.dp, vertical = 10.dp),
                    color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodyMedium,
                )
            }
            Button(onClick = send, enabled = ready, modifier = Modifier.fillMaxWidth().padding(top = 20.dp).height(52.dp)) {
                if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                else Text(stringResource(if (create) R.string.create_account else R.string.sign_in), style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}

/** "Forgot my password": ask for a code by email, then type it with the new password. Signs in at the end. */
@Composable
private fun PasswordReset(app: App, initialEmail: String, onBack: () -> Unit, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    val res = LocalResources.current
    val keyboard = LocalSoftwareKeyboardController.current
    var email by remember { mutableStateOf(initialEmail) }
    var codeSent by remember { mutableStateOf(false) }
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<Int?>(null) }

    fun run(block: suspend () -> Unit) {
        keyboard?.hide()
        busy = true
        error = null
        scope.launch {
            try {
                block()
            } catch (e: ApiException) {
                error = when (e.code) {
                    "INVALID_CODE" -> R.string.error_invalid_code
                    "RESET_UNAVAILABLE" -> R.string.error_reset_unavailable
                    "TOO_MANY_ATTEMPTS", "TOO_MANY_REQUESTS" -> R.string.error_too_many_attempts
                    "INVALID_REQUEST" -> R.string.error_invalid_reset
                    else -> R.string.error_sign_in
                }
            } catch (e: IOException) {
                error = R.string.error_no_connection
            } finally {
                busy = false
            }
        }
    }

    Text(
        stringResource(R.string.reset_title), Modifier.padding(top = 8.dp),
        style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface,
    )
    Text(
        if (codeSent) stringResource(R.string.reset_code_sent, email.trim()) else stringResource(R.string.reset_hint),
        Modifier.padding(top = 4.dp, bottom = 20.dp), style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
    )
    if (!codeSent) {
        OutlinedTextField(
            email, { email = it }, Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.email)) }, leadingIcon = { Icon(Icons.Outlined.Email, null) },
            singleLine = true, shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Send),
        )
    } else {
        OutlinedTextField(
            code, { code = it.filter(Char::isDigit).take(6) }, Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.reset_code)) }, leadingIcon = { Icon(Icons.Outlined.Pin, null) },
            singleLine = true, shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Next),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            password, { password = it }, Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.new_password)) }, leadingIcon = { Icon(Icons.Outlined.Lock, null) },
            singleLine = true, shape = RoundedCornerShape(14.dp), visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            supportingText = { Text(stringResource(R.string.password_hint)) },
        )
    }
    error?.let {
        Text(
            stringResource(it),
            Modifier.fillMaxWidth().padding(top = 12.dp).clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.errorContainer).padding(horizontal = 14.dp, vertical = 10.dp),
            color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodyMedium,
        )
    }
    val ready = !busy && if (codeSent) code.length == 6 && password.length >= 8 else email.isNotBlank()
    Button(
        onClick = {
            if (!codeSent) run { app.backend.requestPasswordReset(email.trim()); codeSent = true }
            else run {
                app.backend.resetPassword(email.trim(), code, password)
                app.sync()
                app.notices.show(Notice(res.getString(R.string.password_changed), NoticeKind.SUCCESS))
                onDone()
            }
        },
        enabled = ready, modifier = Modifier.fillMaxWidth().padding(top = 20.dp).height(52.dp),
    ) {
        if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
        else Text(stringResource(if (codeSent) R.string.save_new_password else R.string.send_code), style = MaterialTheme.typography.titleMedium)
    }
    if (codeSent) TextButton(onClick = { run { app.backend.requestPasswordReset(email.trim()) } }, enabled = !busy) { Text(stringResource(R.string.resend_code)) }
    TextButton(onClick = onBack) { Text(stringResource(R.string.back_to_sign_in)) }
}

