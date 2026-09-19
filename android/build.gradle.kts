plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
}

// Optional: keep build outputs outside the (OneDrive-synced) source tree.
// Usage: ./gradlew assembleDebug -Pcrosswise.buildRoot=C:/dev/crosswise-build
providers.gradleProperty("crosswise.buildRoot").orNull?.let { root ->
    allprojects {
        layout.buildDirectory.set(file("$root/${project.name}"))
    }
}
