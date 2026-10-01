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
}

tasks.test {
  useJUnitPlatform()
  // The vector files both languages read (CD5, CD6), relative to this build.
  systemProperty("capture.shared", layout.projectDirectory.dir("../../src").asFile.absolutePath)
  testLogging {
    events("failed")
    exceptionFormat = TestExceptionFormat.FULL
  }
}
