import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Release signing comes from keystore.properties (kept out of version control); without it, release builds are
// signed with the debug key so they can still be installed and tested.
// Emulator default reaches the host machine; pass -PbackendUrl=https://... for a deployed backend.
val backendUrl: String = providers.gradleProperty("backendUrl").getOrElse("http://10.0.2.2:8787")

val keystore = rootProject.file("keystore.properties").takeIf { it.exists() }?.let { f -> Properties().apply { f.inputStream().use(::load) } }

android {
    namespace = "com.victor.leitor"
    compileSdk {
        version = release(37) {
            minorApiLevel = 2
        }
    }

    defaultConfig {
        applicationId = "com.victor.leitor"
        minSdk = 24
        targetSdk = 36
        // CI passes the run number (-PversionCode=N) so every APK it builds installs over the previous one
        versionCode = providers.gradleProperty("versionCode").getOrElse("1").toInt()
        versionName = "0.1"
        buildConfigField("String", "BACKEND_URL", "\"$backendUrl\"")
    }

    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = rootProject.file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug { manifestPlaceholders["cleartext"] = "true" }
        release {
            // plain HTTP only when the backend itself is http:// (a local test server); https backends keep it blocked
            manifestPlaceholders["cleartext"] = backendUrl.startsWith("http://").toString()
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    packaging {
        // BouncyCastle comes with PdfBox for encrypted PDFs; its post-quantum tables (~8 MB) are never used for that
        resources.excludes += "org/bouncycastle/pqc/**"
    }

    // ML Kit and PdfBox ship native code for four ABIs; one APK per ABI keeps each download small.
    // Only for release tasks, so debug builds keep producing the single app-debug.apk.
    splits {
        abi {
            isEnable = gradle.startParameter.taskNames.any { "Release" in it }
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = true
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended:1.7.8")
    implementation("androidx.activity:activity-compose:1.8.0")
    implementation("com.google.mlkit:translate:17.0.3")
    implementation("com.google.mlkit:language-id:17.0.6")
    implementation("com.google.mlkit:text-recognition:16.0.1") // OCR of scanned PDFs, model bundled (works offline)
    implementation("com.tom-roush:pdfbox-android:2.0.27.0")
    testImplementation("junit:junit:4.13.2")
}
