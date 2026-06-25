plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.aitavern.plugin.androidbridge"
    compileSdk = 36

    defaultConfig {
        minSdk = 31
        targetSdk = 36

        // Consumer ProGuard rules shipped with the library so apps consuming it
        // keep the @JavascriptInterface annotated methods and the Plugin class.
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = false
    }
}

dependencies {
    // Tauri Android runtime exposes the `app.tauri.plugin.Plugin` base class
    // and the `PluginManager` wiring. The :tauri-android project is provided
    // by the Tauri mobile build pipeline.
    implementation(project(":tauri-android"))

    // AndroidX libraries required for WindowInsetsControllerCompat and
    // WindowInsetsCompat used by the status-bar / safe-area logic.
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.appcompat:appcompat:1.7.0")
}
