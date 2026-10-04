package com.seazn.capture.engine.adapter

/**
 * CD32: one value, owned by whoever took it last. A module instance takes the slot in `OnCreate` and
 * releases it in `OnDestroy`. A release by an owner that has since been replaced changes nothing, so
 * a JS reload never clears the new instance's listener, whichever of the two runs first.
 */
class OwnedSlot<T : Any> {
  private var owner: Any? = null

  @Volatile
  var value: T? = null
    private set

  @Synchronized
  fun take(by: Any, value: T) {
    owner = by
    this.value = value
  }

  @Synchronized
  fun release(by: Any) {
    if (owner !== by) return
    owner = null
    value = null
  }
}
