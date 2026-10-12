package com.seazn.capture.engine

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.BridgeCore
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.adapter.FrameTally
import com.seazn.capture.engine.adapter.MicSilenceWatch
import com.seazn.capture.engine.adapter.OwnedSlot
import com.seazn.capture.engine.capture.Capture
import com.seazn.capture.engine.capture.StreamerAdapter
import com.seazn.capture.engine.capture.run.CoreCalls
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.endpoints.TlsGuard
import com.seazn.capture.engine.http.HttpAdapter
import com.seazn.capture.engine.vendor.VendorLines
import com.seazn.capture.engine.watch.CameraWatch
import com.seazn.capture.engine.watch.DeviceSampler
import com.seazn.capture.engine.watch.MicWatch
import com.seazn.capture.engine.watch.NetworkWatch
import com.seazn.capture.engine.watch.PoseWatch
import expo.modules.kotlin.AppContext
import io.github.komedia.komuxer.logger.KomuxerLogger
import io.github.thibaultbee.streampack.core.logger.Logger
import java.io.File
import kotlinx.coroutines.flow.MutableSharedFlow

/**
 * One engine per process (carry 18), built on the application context so a JS reload never leaves
 * it holding a dead React context (CD32). Module instances come and go; each takes the listener and
 * the AppContext slots in OnCreate and releases them in OnDestroy, and a stale release is a no-op.
 */
object EngineHost {
  val listener = OwnedSlot<(String, Map<String, Any?>) -> Unit>()
  val appContext = OwnedSlot<AppContext>()

  private class Parts(val core: BridgeCore, val capture: Capture, val keeper: PairingKeeper)

  @Volatile private var parts: Parts? = null

  /** F-S4-1: camera losses held for the capture's watch; one loss per device event, so a few are plenty. */
  private const val LOSSES_HELD = 8

  fun core(context: Context): BridgeCore = parts(context).core

  fun capture(context: Context): Capture = parts(context).capture

  /** The pairing's keeper, for the foreground service (Task 38). */
  fun keeper(context: Context): PairingKeeper = parts(context).keeper

  /**
   * Re-review 4 cap: the app's return to the foreground (the module's lifecycle), for the capture's camera
   * rebuilds. Only a capture already built hears it: a foreground builds nothing.
   */
  fun foreground() {
    parts?.capture?.foreground()
  }

  /** A glue line into the record, from any thread; dropped before the core exists. */
  fun line(entry: RecordEntry) {
    parts?.core?.log(entry.level, entry.kind, entry.fields.toMap())
  }

  @Synchronized
  private fun parts(context: Context): Parts = parts ?: build(context.applicationContext).also { parts = it }

  private fun build(app: Context): Parts {
    // F-S4-1: StreamPack's own lines are its only word that a camera was lost; the capture hears them here.
    val cameraLosses = MutableSharedFlow<String>(extraBufferCapacity = LOSSES_HELD)
    val vendor = VendorLines({ id -> cameraLosses.tryEmit(id) }) { level, fields -> parts?.core?.log(level, "vendor-log", fields) }
    Logger.logger = VendorLogger(vendor)
    KomuxerLogger.logger = KomuxerVendorLogger(vendor) // C6 m-4: RTMPS's own
    TlsGuard.record = ::line
    TlsGuard.install(TlsGuard.MODE)
    val thread = HandlerThread("capture-engine").apply { start() }
    lateinit var core: BridgeCore
    val report: (Input) -> Unit = { core.report(it) }
    // Review C7 fix rounds 2 and 3: EngineHost.line drops lines until this build returns, and every watcher started
    // here can write before that (the device sampler samples at once; a callback can answer at registration). Their
    // lines go to the core: the one line of every watcher the build starts. None writes before core.start(), after
    // which startWatchers starts them.
    val toCore: (RecordEntry) -> Unit = { core.log(it.level, it.kind, it.fields.toMap()) }
    val cameras = CameraAvailability()
    val pose = PoseWatch(app, { core.readiness(pose = it) }, ::line)
    // C6 carry: the build encodes the side held (CD42), the pose watch's, never a constant.
    val capture = StreamerAdapter(app, FrameTally(), AttemptSignals(), cameras, coreCalls { core }, pose::side, cameraLosses)
    val device = DeviceSampler(app, report, toCore)
    val keeper = keeper(app) { core }
    // Task 34: a debug build's seam may hold another HTTP path; a release build's never does.
    val http = HttpSeam.override?.invoke(app) ?: HttpAdapter()
    val platform = AndroidPlatform(capture, http, RecordFile(File(app.filesDir, "record")), pose, device, keeper, ::emit, power = { PowerState.mode(app) })
    core = BridgeCore.shared { core(app, thread, platform) }
    core.start()
    // Review C7 M-9: the core runs from here, so a throw must not end this build half done; core.log, as
    // EngineHost.line drops lines until the build returns.
    try {
      ExitReader.previousLoss(app)?.let { core.log("warn", it.kind, it.fields.toMap()) }
    } catch (e: Exception) {
      core.log("warn", "watch-failed", mapOf("action" to "exit-read", "error" to e.javaClass.simpleName))
    }
    startWatchers(app, cameras, capture, device, report, toCore)
    return Parts(core, capture, keeper)
  }

  /** CD32, I2: the AppContext is read at request time, so a JS reload's new module is the one asked. */
  private fun keeper(app: Context, core: () -> BridgeCore) =
    PairingKeeper(
      app,
      Permissions { appContext.value },
      ::line,
      answered = { granted -> core().report(Input.PermissionsAnswered(granted)) },
      askFailed = { t -> core().askFailed(t) },
      language = { core().language() },
    )

  /**
   * After `core.start()`, so their first reports are posted to a running engine. Inside the first build,
   * so CameraWatch feeds the capture's own [CameraAvailability] before any open (C6 carry): the capture
   * opens only on the engine's word, which needs this build to have returned. The four live for the
   * process: the contended set and the network must be true before the first pairing.
   */
  private fun startWatchers(app: Context, cameras: CameraAvailability, capture: StreamerAdapter, device: DeviceSampler, report: (Input) -> Unit, toCore: (RecordEntry) -> Unit) {
    CameraWatch(app, cameras, report, toCore).start()
    MicWatch(app, capture::audioSessionId, MicSilenceWatch(), report, toCore).start()
    NetworkWatch(app, report, toCore).start()
    device.start()
  }

  /**
   * Each call reads the core when it runs, after `build` has assigned it: nothing reaches the capture
   * until `core.start()` has run and an intent arrives.
   */
  private fun coreCalls(core: () -> BridgeCore) =
    CoreCalls(
      report = { core().report(it) },
      failure = { core().failure(it) },
      pairFailed = { request, t -> core().pairFailed(request, t) },
      cameraBusy = { request -> core().cameraBusy(request) },
      readiness = { frames, peak -> core().readiness(cameraFrames = frames, audioPeak = peak) },
      line = ::line,
    )

  /**
   * The phone's facts for the claim (G0-e): the app's version and the model, never a hardware id. D15:
   * the model is `Build.MODEL` alone; the beat trims it, caps it at 80 characters and sends a blank one
   * as null (`Beats.model`).
   */
  private fun core(app: Context, thread: HandlerThread, platform: AndroidPlatform) =
    BridgeCore(
      AndroidClock,
      HandlerScheduler(Handler(thread.looper)),
      platform,
      AndroidStore(File(app.noBackupFilesDir, "capture")),
      appVersion(app),
      Build.MODEL.orEmpty(),
    )

  /** minSdk 31 (CD34): the `Int` overload runs on every supported phone; the flags overload is API 33. */
  @Suppress("DEPRECATION")
  private fun appVersion(app: Context): String = app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: "0.0.0"

  private fun emit(event: String, body: Map<String, Any?>) {
    listener.value?.invoke(event, body)
  }
}
