package com.seazn.capture.engine.capture

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.core.content.ContextCompat
import com.seazn.capture.engine.R
import com.seazn.capture.engine.core.Encode
import io.github.thibaultbee.streampack.core.elements.sources.video.bitmap.BitmapSourceFactory

/** The phone-made still on air while the camera is someone else's (spec §3): no words, so no language. */
object SlateSource {
  @Volatile private var card: Bitmap? = null

  fun factory(context: Context) = BitmapSourceFactory(card ?: draw(context).also { card = it })

  private fun draw(context: Context): Bitmap {
    // The picture on air while the camera is someone else's: the encode's frame, so the encode's size.
    val bitmap = Bitmap.createBitmap(Encode.WIDTH, Encode.HEIGHT, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(ContextCompat.getColor(context, R.color.seazn_ground))
    val glyph = ContextCompat.getDrawable(context, R.drawable.slate) ?: return bitmap
    val left = (Encode.WIDTH - GLYPH) / 2
    val top = (Encode.HEIGHT - GLYPH) / 2
    glyph.setBounds(left, top, left + GLYPH, top + GLYPH) // a square, centred
    glyph.draw(canvas)
    return bitmap
  }

  /** The glyph's side in px. */
  private const val GLYPH = 240
}
