package com.seazn.capture.engine

import android.Manifest
import android.app.Activity
import android.os.Build
import com.facebook.react.modules.core.PermissionAwareActivity
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.AppContext

enum class Grant { GRANTED, REFUSED, UNAVAILABLE }

/**
 * CD21: camera and microphone through Expo's permissions manager, on the current module's AppContext
 * (CD32). Expo 57.0.20's `PermissionsService.delegateRequestToActivity` answers DENIED for every
 * permission when the current activity is not a `PermissionAwareActivity`, so a request no operator
 * saw would read as a refusal. That case, and no activity at all, is [Grant.UNAVAILABLE].
 */
class Permissions(private val appContext: () -> AppContext?) {
  fun request(onResult: (Grant) -> Unit) {
    val context = appContext() ?: return onResult(Grant.UNAVAILABLE)
    if (!permissionAware(context.currentActivity)) return onResult(Grant.UNAVAILABLE)
    val manager = context.permissions ?: return onResult(Grant.UNAVAILABLE)
    try {
      manager.askForPermissions({ answers ->
        val granted = NEEDED.all { answers[it]?.status == PermissionsStatus.GRANTED }
        onResult(if (granted) Grant.GRANTED else Grant.REFUSED)
      }, *(NEEDED + optional()))
    } catch (e: IllegalStateException) { // Expo's "Another permissions request is in progress" (WRITE_SETTINGS path), or no activity provider
      onResult(Grant.UNAVAILABLE)
    }
  }

  /**
   * React's `PermissionAwareActivity`, by type (review C7 M-5): react-android is this module's own dependency,
   * unversioned, as every Expo module here has it, so a minified build renames the check with the class.
   */
  private fun permissionAware(activity: Activity?): Boolean = activity is PermissionAwareActivity

  /** POST_NOTIFICATIONS is asked with them on API 33+, and blocks nothing: a refusal only hides the notification. API 31–32 allow notifications by default (CD34). */
  private fun optional(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) arrayOf(Manifest.permission.POST_NOTIFICATIONS) else emptyArray()

  companion object {
    private val NEEDED = arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
  }
}
