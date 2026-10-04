// The JVM host for the JS contract kit (plan C, CD8). Never shipped.
plugins {
  kotlin("jvm")
  application
}

kotlin {
  jvmToolchain(17)
  compilerOptions { allWarningsAsErrors.set(true) }
}

dependencies {
  implementation(rootProject)
  implementation("org.json:json:20240303")
  testImplementation(kotlin("test"))
}

application { mainClass.set("com.seazn.capture.engine.host.MainKt") }

tasks.test {
  useJUnitPlatform()
  // The server bodies the core's tests share (review C4a m-4), read as the core's tests read theirs.
  systemProperty("capture.shared", layout.projectDirectory.dir("../../../src").asFile.absolutePath)
  inputs
    .file(layout.projectDirectory.file("../../../src/wire/server-bodies.json"))
    .withPropertyName("serverBodies")
    .withPathSensitivity(PathSensitivity.RELATIVE)
}
