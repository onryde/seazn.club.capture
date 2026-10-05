package com.seazn.capture.engine

import android.Manifest
import android.app.Activity
import android.os.Build
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
   * React's `PermissionAwareActivity`, by name: react-android is on the app's classpath but not on this
   * module's compile path (expo-modules-core keeps it `implementation`). Should the name not resolve, as
   * a minified build that renames it would, the activity is asked as before, never refused outright.
   */
  private fun permissionAware(activity: Activity?): Boolean {
    if (activity == null) return false
    val aware =
      try {
        Class.forName(PERMISSION_AWARE, false, activity.javaClass.classLoader)
      } catch (e: ClassNotFoundException) {
        return true
      }
    return aware.isInstance(activity)
  }

  /** POST_NOTIFICATIONS is asked with them on API 33+, and blocks nothing: a refusal only hides the notification. API 31–32 allow notifications by default (CD34). */
  private fun optional(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) arrayOf(Manifest.permission.POST_NOTIFICATIONS) else emptyArray()

  companion object {
    private val NEEDED = arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
    private const val PERMISSION_AWARE = "com.facebook.react.modules.core.PermissionAwareActivity"
  }
}
