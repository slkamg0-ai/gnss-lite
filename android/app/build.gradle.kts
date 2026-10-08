plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "kr.gnsslite.field"
    compileSdk = 34

    defaultConfig {
        applicationId = "kr.gnsslite.field"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")                       // WebViewAssetLoader (https 가상 출처)
    implementation("androidx.security:security-crypto:1.1.0-alpha06")     // NTRIP 계정 암호화 저장
    implementation("com.github.mik3y:usb-serial-for-android:3.8.0")       // CH340 등 USB 시리얼
}
