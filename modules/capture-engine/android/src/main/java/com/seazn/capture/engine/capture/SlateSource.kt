package com.seazn.capture.engine.capture

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.core.content.ContextCompat
import com.seazn.capture.engine.R
import io.github.thibaultbee.streampack.core.elements.sources.video.bitmap.BitmapSourceFactory

/** The phone-made still on air while the camera is someone else's (spec §3): no words, so no language. */
object SlateSource {
  @Volatile private var card: Bitmap? = null

  fun factory(context: Context) = BitmapSourceFactory(card ?: draw(context).also { card = it })

  private fun draw(context: Context): Bitmap {
    val bitmap = Bitmap.createBitmap(1280, 720, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(ContextCompat.getColor(context, R.color.seazn_ground))
    val glyph = ContextCompat.getDrawable(context, R.drawable.slate) ?: return bitmap
    glyph.setBounds(520, 240, 760, 480) // 240 px square, centred
    glyph.draw(canvas)
    return bitmap
  }
}
