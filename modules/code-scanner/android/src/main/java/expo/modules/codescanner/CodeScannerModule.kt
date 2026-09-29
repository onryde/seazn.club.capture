package expo.modules.codescanner

import android.content.Context
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Google's code scanner (spec §3). Every outcome resolves — the promise never
 * rejects — so JavaScript maps one closed set of results and a scanner failure
 * can never surface as an unhandled rejection on the Home screen.
 */
class CodeScannerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CodeScanner")

    AsyncFunction("scan") { promise: Promise ->
      val context = context()
      if (!hasPlayServices(context)) {
        promise.resolve(unavailable("noPlayServices"))
      } else {
        GmsBarcodeScanning.getClient(context, QR_ONLY).startScan()
          .addOnSuccessListener { barcode ->
            val raw = barcode.rawValue
            promise.resolve(if (raw == null) unavailable("failed") else mapOf("outcome" to "scanned", "raw" to raw))
          }
          .addOnCanceledListener { promise.resolve(mapOf("outcome" to "cancelled")) }
          .addOnFailureListener { error -> promise.resolve(resultFor(error)) }
      }
    }

    // Fire-and-forget: ask Play services to fetch the scanner before the
    // first tap. The manifest route only works for Play Store installs.
    Function("prepare") {
      val context = context()
      if (hasPlayServices(context)) {
        val request = ModuleInstallRequest.newBuilder()
          .addApi(GmsBarcodeScanning.getClient(context))
          .build()
        ModuleInstall.getClient(context).installModules(request)
      }
      Unit
    }
  }

  private fun context(): Context =
    appContext.currentActivity ?: appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun hasPlayServices(context: Context): Boolean =
    GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

  private fun resultFor(error: Exception): Map<String, String> =
    when ((error as? MlKitException)?.errorCode) {
      MlKitException.CODE_SCANNER_CANCELLED -> mapOf("outcome" to "cancelled")
      MlKitException.CODE_SCANNER_UNAVAILABLE -> unavailable("installing")
      MlKitException.CODE_SCANNER_GOOGLE_PLAY_SERVICES_VERSION_TOO_OLD -> unavailable("noPlayServices")
      else -> unavailable("failed")
    }

  private fun unavailable(reason: String) = mapOf("outcome" to "unavailable", "reason" to reason)

  private companion object {
    val QR_ONLY: GmsBarcodeScannerOptions =
      GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
  }
}
