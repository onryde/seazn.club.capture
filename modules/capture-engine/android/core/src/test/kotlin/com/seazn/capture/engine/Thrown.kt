package com.seazn.capture.engine

/** A throwable as a vendor's code makes it: its stack starts at [method] of [type], where it was thrown. */
fun <T : Throwable> thrownAt(error: T, type: String, method: String): T =
  error.apply { stackTrace = arrayOf(StackTraceElement(type, method, "${type.substringAfterLast('.').substringBefore('$')}.kt", 1)) + stackTrace }

/** StreamPack 3.2.1's packages (its sources), where the throws a start may meet are made. */
object StreamPack {
  const val PIPELINE_OUTPUT = "io.github.thibaultbee.streampack.core.pipelines.outputs.encoding.EncodingPipelineOutput"
  const val CAMERA = "io.github.thibaultbee.streampack.core.elements.sources.video.camera"
  const val ENCODER = "io.github.thibaultbee.streampack.core.elements.encoders.mediacodec.MediaCodecEncoder"
  const val TS_MUXER = "io.github.thibaultbee.streampack.core.elements.endpoints.composites.muxers.ts.TsMuxer"
}
