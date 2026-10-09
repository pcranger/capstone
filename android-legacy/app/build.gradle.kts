import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// Build-time configuration; never display or log credential values.
val serviceEnv = rootProject.file("../../capstone_ios/.env").takeIf { it.exists() }?.readLines()
    ?.filter { it.contains("=") && !it.trim().startsWith("#") }
    ?.associate { it.substringBefore("=").trim() to it.substringAfter("=").trim().trim('"', '\'') }.orEmpty()
fun serviceKey(name: String) = System.getenv(name) ?: serviceEnv[name].orEmpty()
fun quoted(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.crosswise"
    compileSdk = 36

    defaultConfig {
        applicationId = providers.gradleProperty("crosswiseApplicationId").getOrElse("com.crosswise.app")
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.2.0"
        buildConfigField("String", "MAPS_API_KEY", quoted(serviceKey("GOOGLE_MAP_API_KEY")))
        buildConfigField("String", "GEMINI_API_KEY", quoted(serviceKey("GEMINI_API_KEY")))
        manifestPlaceholders["appLabel"] = if (applicationId.orEmpty().endsWith(".preview")) "CrossWise Preview" else "CrossWise"
        manifestPlaceholders["mapsApiKey"] = serviceKey("GOOGLE_MAP_API_KEY")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // Models are memory-mapped / loaded by LiteRT directly from the APK, so keep them uncompressed.
    androidResources {
        noCompress += "tflite"
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("com.google.maps.android:maps-compose:6.12.0")
    implementation("androidx.compose.material:material-icons-extended")
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    // Icon set for the camera-first chrome (settings, refresh, tabs). Version comes from the Compose BOM.
    implementation("androidx.compose.material:material-icons-core")
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.litert)

    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.org.json)
}
