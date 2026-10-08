import org.gradle.api.tasks.testing.logging.TestExceptionFormat

plugins {
  // The Kotlin that React Native 0.86.3's version catalog pins (`kotlin = "2.1.20"`). The app is
  // compiled by a newer one, 2.3.0 (app.json's `kotlinVersion`, which the module's app.plugin.ts
  // pins on the root classpath for StreamPack 3.2.1, C7u), and a newer compiler reads an older
  // jar's metadata. So the core may stay at or below the app's Kotlin, never above it.
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
  // Task 36: the capture's rules run on one coroutine consumer (PV38); their order is tested on a test
  // dispatcher. 1.10.2 is the coroutines the app resolves (`:app:dependencies`).
  testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
  testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
}

// Task 33: the glue's HTTP adapter imports nothing Android, so its folder compiles into core's tests too.
// It ships in the Android library alone: `main` here stays dependency-free.
kotlin.sourceSets["test"].kotlin.srcDir("../src/main/java/com/seazn/capture/engine/http")

// Task 34: the scripted server's pure rules and server live in the glue's debug source set, so a release
// never compiles them; core's tests compile that one folder to test them on the JVM.
kotlin.sourceSets["test"].kotlin.srcDir("../src/debug/java/com/seazn/capture/engine/debug/script")

// Task 36: the capture's rules (which call comes when, which attempt the endpoint holds, what is reported)
// import nothing Android, so core's tests run them against a fake of StreamPack's parts.
kotlin.sourceSets["test"].kotlin.srcDir("../src/main/java/com/seazn/capture/engine/capture/run")

// Spec §8: the photo's bound and its two results import nothing Android or StreamPack, so core's tests run them
// against a lambda that stands for the gallery write. The writer, which does import them, is one folder up.
kotlin.sourceSets["test"].kotlin.srcDir("../src/main/java/com/seazn/capture/engine/capture/photo")

// C6 I-2: our SRT sink's connect and end sit behind a socket port, apart from StreamPack and srtdroid, so
// core's tests run the sink's own order against a fake of srtdroid's socket.
kotlin.sourceSets["test"].kotlin.srcDir("../src/main/java/com/seazn/capture/engine/srt/connect")

// C6 m-4: the vendor loggers' one rule (StreamPack's and komuxer's) imports nothing, so core's tests run it into
// a real record. komuxer's JVM variant is Java 21 bytecode, which core's 17 cannot load, so the adapters stay out.
kotlin.sourceSets["test"].kotlin.srcDir("../src/main/java/com/seazn/capture/engine/vendor")

// C6 re-review: the glue's one DNS lookup, for both transports, imports nothing Android, so core's tests run
// it against the start's bound.
kotlin.sourceSets["test"].kotlin.srcDir("../src/main/java/com/seazn/capture/engine/net")

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
  // The app's theme tokens, which the slate's colours must equal (Task 36, M11), under the same rule.
  systemProperty("capture.tokens", layout.projectDirectory.file("../../../../src/ui/theme/tokens.ts").asFile.absolutePath)
  inputs
    .file(layout.projectDirectory.file("../../../../src/ui/theme/tokens.ts"))
    .withPropertyName("themeTokens")
    .withPathSensitivity(PathSensitivity.RELATIVE)
  // The glue module's whole `src` (Task 19), so GlueRulesTest sees `main`, `debug` and any `release`
  // source set. Its files are inputs under the same rule as the vectors, so a glue-only edit reruns
  // the rules.
  systemProperty("capture.glue", layout.projectDirectory.dir("../src").asFile.absolutePath)
  inputs
    .files(fileTree(layout.projectDirectory.dir("../src")))
    .withPropertyName("glueSources")
    .withPathSensitivity(PathSensitivity.RELATIVE)
  // GlueRulesTest also reads the module's build.gradle and the keep rules it hands the app, beside `src`
  // (review C7 M-5, final review M6): inputs under the same rule, so an edit to either reruns the rules.
  inputs
    .files(layout.projectDirectory.file("../build.gradle"), layout.projectDirectory.file("../consumer-rules.pro"))
    .withPropertyName("glueBuild")
    .withPathSensitivity(PathSensitivity.RELATIVE)
  testLogging {
    events("failed")
    exceptionFormat = TestExceptionFormat.FULL
  }
}
