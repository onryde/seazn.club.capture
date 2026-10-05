import org.gradle.api.tasks.testing.logging.TestExceptionFormat

plugins {
  // The Kotlin that React Native 0.86.3's version catalog pins (`kotlin = "2.1.20"`), which
  // Expo 57's root-project plugin hands every module as `kotlinVersion`. The app and the core
  // are compiled by the same Kotlin, so the library that consumes this jar reads its metadata.
  kotlin("jvm") version "2.1.20"
}

group = "com.seazn.capture"
version = "0.1.0"

kotlin {
  jvmToolchain(17)
  compilerOptions { allWarningsAsErrors.set(true) }
}

dependencies {
  testImplementation(kotlin("test"))
  // Reads the vector files shared with the JS side (CD4). Tests only: `main` stays dependency-free.
  testImplementation("org.json:json:20240303")
  // Task 33: the glue's HTTP adapter, run on the JVM against a local server, on the OkHttp the app
  // resolves at runtime (`:app:dependencies`: 4.9.2 -> 4.12.0). The library compiles against 4.9.2.
  testImplementation("com.squareup.okhttp3:okhttp:4.12.0")
  testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}

// Task 33: the glue's HTTP adapter imports nothing Android, so its folder compiles into core's tests too.
// It ships in the Android library alone: `main` here stays dependency-free.
kotlin.sourceSets["test"].kotlin.srcDir("../src/main/java/com/seazn/capture/engine/http")

// Task 34: the scripted server's pure rules and server live in the glue's debug source set, so a release
// never compiles them; core's tests compile that one folder to test them on the JVM.
kotlin.sourceSets["test"].kotlin.srcDir("../src/debug/java/com/seazn/capture/engine/debug/script")

tasks.test {
  useJUnitPlatform()
  // The vector files both languages read (CD5, CD6), relative to this build.
  systemProperty("capture.shared", layout.projectDirectory.dir("../../src").asFile.absolutePath)
  // Gradle tracks the property's path, not the files under it: declared here, a vector-only edit
  // reruns the tests instead of reading as UP-TO-DATE (review C0a, I3).
  inputs
    .dir(layout.projectDirectory.dir("../../src/wire"))
    .withPropertyName("sharedVectors")
    .withPathSensitivity(PathSensitivity.RELATIVE)
  // The record's allow-list and scrub vectors (CD6, carry 11), under the same rule.
  inputs
    .dir(layout.projectDirectory.dir("../../src/scrub"))
    .withPropertyName("scrubVectors")
    .withPathSensitivity(PathSensitivity.RELATIVE)
  // The app's dictionaries, which the notification's words must equal (Task 18), under the same rule.
  systemProperty("capture.i18n", layout.projectDirectory.dir("../../../../src/i18n").asFile.absolutePath)
  inputs
    .files(fileTree(layout.projectDirectory.dir("../../../../src/i18n")) { include("*.json") })
    .withPropertyName("dictionaries")
    .withPathSensitivity(PathSensitivity.RELATIVE)
  // The glue module's whole `src` (Task 19), so GlueRulesTest sees `main`, `debug` and any `release`
  // source set. Its files are inputs under the same rule as the vectors, so a glue-only edit reruns
  // the rules.
  systemProperty("capture.glue", layout.projectDirectory.dir("../src").asFile.absolutePath)
  inputs
    .files(fileTree(layout.projectDirectory.dir("../src")))
    .withPropertyName("glueSources")
    .withPathSensitivity(PathSensitivity.RELATIVE)
  testLogging {
    events("failed")
    exceptionFormat = TestExceptionFormat.FULL
  }
}
