# Notice: SeaznSrtSink

`SeaznSrtSink.kt` is adapted from StreamPack 3.2.0's `SrtSink`
(`io.github.thibaultbee.streampack.ext.srt.elements.endpoints.composites.sinks.SrtSink`),
Copyright (C) 2024 Thibault B., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). The file keeps StreamPack's licence header.

What changed (S1 plan C, Task 35; CD14, F-P5-1, F-P5-11, R3):

- Every socket option comes from our `SrtPlan` (`SrtOptions.plan`), so no secret is ever written into an
  SRT URL, and INPUTBW and MAXBW are bytes per second, never the encoder's bits.
- The host is resolved on the IO dispatcher before the connect, so a dead DNS is an `UnknownHostException`.
- One drop per attempt is reported from the socket's completion through `AttemptSignals`.
- StreamPack's logging and metrics are removed; nothing is logged.

`buildMsgCtrl` (here `msgCtrl`) is copied as it stands.
