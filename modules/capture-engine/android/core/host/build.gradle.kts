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

tasks.test { useJUnitPlatform() }
