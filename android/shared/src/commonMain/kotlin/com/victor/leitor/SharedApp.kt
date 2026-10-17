package com.victor.leitor

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

/** The shared app. For now only proves the pipeline: this screen built by CI and running on an iPhone. */
@Composable
fun SharedApp() {
    MaterialTheme(colorScheme = darkColorScheme()) {
        Surface(Modifier.fillMaxSize()) {
            Box(contentAlignment = Alignment.Center) {
                Text("Entrelinhas no iPhone", style = MaterialTheme.typography.headlineSmall)
            }
        }
    }
}
