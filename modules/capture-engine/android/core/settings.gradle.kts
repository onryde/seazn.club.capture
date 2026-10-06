// The engine's pure-Kotlin core (spec §3, decision 10). A standalone build with its own wrapper:
// its tests need JDK 17 and Gradle, and no Android SDK (spec §6). Plan C's Expo Android library
// compiles these sources into itself (CD2), so this build must never apply an Android plugin.
// `host` is the JVM host the JS contract kit runs (CD8); it is never shipped.
rootProject.name = "capture-engine-core"

dependencyResolutionManagement {
  repositories { mavenCentral() }
}

include("host")
