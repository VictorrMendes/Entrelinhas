plugins {
    id("com.android.application") version "9.2.1" apply false
    id("com.android.kotlin.multiplatform.library") version "9.2.1" apply false
    // iOS needs Kotlin 2.2.20+; the Compose compiler plugin always matches the Kotlin version
    id("org.jetbrains.kotlin.multiplatform") version "2.4.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.20" apply false
    id("org.jetbrains.compose") version "1.12.1" apply false
}
