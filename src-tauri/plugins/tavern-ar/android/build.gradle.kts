plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.aitavern.plugin.ar"
    compileSdk = 36

    defaultConfig {
        minSdk = 31
        targetSdk = 36

        // Consumer ProGuard rules shipped with the library so apps consuming it
        // keep the @Command annotated methods and the Plugin/Activity classes.
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
    // and the `PluginManager` wiring.
    implementation(project(":tauri-android"))

    // AndroidX libraries for Activity lifecycle and appcompat.
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.appcompat:appcompat:1.7.0")

    // ARCore for spatial anchoring (plane detection, camera tracking, light estimation).
    implementation("com.google.ar:core:1.42.0")

    // MediaPipe Tasks Vision for hand gesture recognition.
    // Provides 21-point hand landmark detection running on-device.
    // Used to detect pet/wave/tap/pinch gestures in the AR camera feed.
    implementation("com.google.mediapipe:tasks-vision:0.10.14")
}
