# A1 spike: can the preview be told its size without a fork?

**Date:** 2026-10-12 · **Finding:** N30 · **Authority:** `docs/specs/2026-10-11-s1-d3-findings-design.md` §4 ·
**Plan:** `docs/superpowers/plans/2026-10-11-s1-d3-fixes.md`, Task 3.1

**Verdict: `DECORATOR`.** StreamPack 3.2.1's `PreviewView` reaches its provider only through two interface calls,
casts the source only to interfaces, and takes the viewfinder's size from one interface call,
`IPreviewableSource.getPreviewSize(Size, Class)`. That size becomes the viewfinder surface's buffer size, and the
camera session takes that surface as an output with no size of its own. So a provider of ours that shows the
`PreviewView` the camera through a decorator, with only `getPreviewSize` answered by the 16:9 rule, sizes the preview
stream. No fork, no patch and no change to the strict pin.

Read offline with `javap` (JDK 17) from the Gradle cache. A read is a hypothesis (AGENTS §0): the decorator's own
bytecode (Task 3.3) and the device (Batch 9) settle it.

## Inputs

| Artifact                                       | SHA-1 (the cache folder, checked with `shasum`) |
| ---------------------------------------------- | ----------------------------------------------- |
| `streampack-ui-3.2.1.aar`                      | `e13c3abfcd84b37914526018f654282eafd731ef`      |
| `streampack-core-3.2.1.aar`                    | `5596b2ce6f2f7c843dcd6c736a57d858968cadbd`      |
| `viewfinder-view-1.4.0-alpha13.aar` (androidx) | `41dce6c0d030e6d0ece3ba7b71c9af4e4fd254c1`      |

`streampack-ui-3.2.1.pom` names `androidx.camera.viewfinder:viewfinder-view:1.4.0-alpha13` (runtime), the
`CameraViewfinder` that `PreviewView` holds.

## 1. Unpack

```bash
SP="$SCR/sp"; G=~/.gradle/caches/modules-2/files-2.1/io.github.thibaultbee.streampack
unzip -o -q "$(ls $G/streampack-ui/3.2.1/*/streampack-ui-3.2.1.aar)" classes.jar -d "$SP/ui"
unzip -o -q "$(ls $G/streampack-core/3.2.1/*/streampack-core-3.2.1.aar)" classes.jar -d "$SP/core"
```

## 2. Every call `PreviewView` and its inner classes make into the core

The plan's command, with `invokestatic` added to the filter (a superset: it also lists the static helpers):

```bash
CP="$SP/ui/classes.jar:$SP/core/classes.jar"
for c in $(unzip -Z1 "$SP/ui/classes.jar" | grep '^io/github/thibaultbee/streampack/ui/views/PreviewView' \
  | sed 's/\.class$//; s#/#.#g'); do
  echo "== $c"; javap -p -c -classpath "$CP" "$c" \
    | grep -E 'invokeinterface|invokevirtual|invokestatic|checkcast|instanceof' | grep -E 'thibaultbee/streampack/core'
done
```

The distinct core members called (count of call sites):

```
   8 pipelines/inputs/IVideoInput.getSourceFlow
   8 interfaces/IWithVideoSource.getVideoInput
   5 elements/sources/video/IPreviewableSource.getPreviewMutex
   4 elements/sources/video/IPreviewableSource.stopPreview
   4 elements/sources/video/IPreviewableSource.resetPreview
   4 elements/sources/video/camera/ICameraSource.getSettings
   3 elements/sources/video/camera/CameraSettings.getZoom
   2 elements/sources/video/IPreviewableSource.requestRelease
   1 elements/sources/video/IPreviewableSource.startPreview
   1 elements/sources/video/IPreviewableSource.getPreviewSize
   1 elements/sources/video/camera/ICameraSource.getCameraId
   1 elements/sources/video/camera/extensions/ContextExtensionsKt.getCameraCharacteristics
   1 elements/sources/video/camera/CameraSettings$Zoom.{addListener,removeListener,onPinch}, FocusMetering.tapToFocus
   2 elements/utils/OrientationUtils, ConflatedJob, History, SharedFlowExtensionsKt.runningHistoryNotNull (helpers)
```

Every cast and `instanceof` in `PreviewView` and its inner classes, by target:

| Target                                                              | Kind                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| `core/interfaces/IWithVideoSource`                                  | interface                                               |
| `core/elements/sources/video/IVideoSource`                          | interface (empty)                                       |
| `core/elements/sources/video/IPreviewableSource`                    | interface                                               |
| `core/elements/sources/video/camera/ICameraSource`                  | interface                                               |
| `CameraSettings$Zoom`, `MeteringPointFactory`, `History`, `ILogger` | not the source: the real source's settings, and helpers |

The three conditions:

- **(a) holds.** The provider is used only as `IWithVideoSource.getVideoInput()` then `IVideoInput.getSourceFlow()`
  (bytecode offsets: `setVideoSourceProvider$2` 213–231, `collectSource$1` 40–45, `startPreview(Size)` 29–47); the flow is read with
  `StateFlow.getValue()` and, cast to `SharedFlow`, through `runningHistoryNotNull`.
- **(b) holds.** No cast or `instanceof` names `CameraSource`, `AbstractPreviewableSource` or any `…Internal` type.
- **(c) holds.** The viewfinder's size comes from one call, `PreviewView.getPreviewSize(IPreviewableSource, Size)`:

```
0: aload_1
1: aload_2
2: ldc_w   #836  // class android/view/SurfaceHolder
5: invokeinterface #839, 3  // InterfaceMethod IPreviewableSource.getPreviewSize:(Landroid/util/Size;Ljava/lang/Class;)Landroid/util/Size;
```

and `startPreview(Size, IPreviewableSource)` builds the request from that answer alone:

```
46: invokespecial #640  // Method getPreviewSize:(IPreviewableSource;Landroid/util/Size;)Landroid/util/Size;
77: invokespecial #652  // Method androidx/camera/viewfinder/core/ViewfinderSurfaceRequest$Builder."<init>":(Landroid/util/Size;)V
104: invokeinterface #658  // InterfaceMethod ICameraSource.getCameraId:()Ljava/lang/String;   (characteristics, for rotation only)
```

The `Size` passed in is the `PreviewView`'s own size (`ViewExtensionsKt.getSize(this)`), which `CapturePreviewView`
lays out at the encode's 1280 × 720.

## 3. The flow's type and the interfaces' members

```bash
javap -s -p -classpath "$CP" io.github.thibaultbee.streampack.core.pipelines.inputs.IVideoInput
javap -v -classpath "$CP" io.github.thibaultbee.streampack.core.pipelines.inputs.IVideoInput | grep -A3 getSourceFlow
javap -p -s -classpath "$CP" …camera.ICameraSource …video.IPreviewableSource …video.IVideoSource …interfaces.IWithVideoSource
```

`getSourceFlow`'s signature is `()Lkotlinx/coroutines/flow/StateFlow<Lio/github/thibaultbee/streampack/core/elements/sources/video/IVideoSource;>;`:
the element type is the public `IVideoSource` (nullable in Kotlin), **not** an `…Internal` interface. The decorator
needs no internal type.

| Interface            | Members                                                                                                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IWithVideoSource`   | `getVideoInput()` abstract; `setVideoSource(Factory)` a JVM default                                                                                                                                                                             |
| `IVideoInput`        | `isStreamingFlow()`, `getSourceFlow()`, `setSource(Factory)`, `getWithConfig()`, `getProcessor()` abstract; `isMuted()`, `setMuted(Boolean)` JVM defaults; `takeSnapshot(Int)` abstract, from `ISnapshotable`                                   |
| `ICameraSource`      | `getCameraId()`, `getSettings()` abstract; extends `IVideoSource` (no members) and `IPreviewableSource`                                                                                                                                         |
| `IPreviewableSource` | `getPreviewMutex()`, `isPreviewingFlow()`, `hasPreview()`, `setPreview(Surface)`, `startPreview()`, `stopPreview()`, `resetPreview()`, `requestRelease()`, `<T> getPreviewSize(Size, Class<T>)` abstract; `startPreview(Surface)` a JVM default |

Every type in those signatures is public (`ISurfaceProcessor`, `ISnapshotable`, `CameraSettings`, `Mutex`,
`StateFlow`). The defaults are compiled as JVM default methods (`ICameraSource` also keeps a `DefaultImpls` for
`startPreview(Surface)`). `CameraSource` inherits `AbstractPreviewableSource`, which **overrides** the default
`startPreview(Surface)`, `getPreviewMutex()`, `resetPreview()` and `requestRelease()`. So Kotlin's `by` delegation must
forward the default `startPreview(Surface)` to the real source too, not fall back to the interface's body. Kotlin
delegates every member of a Kotlin interface that the class does not override, defaults included; Task 3.3 proves it
on the decorator's own bytecode.

## 4. Does the camera size its preview stream from the surface it is given?

```bash
for c in $(unzip -Z1 "$SP/core/classes.jar" | grep -E 'sources/video/camera/(CameraSource|utils/CameraSizes|utils/CameraSurface|controllers/.*|sessioncompat/.*|ICameraSource.*)(\$[A-Za-z0-9$]*)?\.class$' \
  | sed 's/\.class$//; s#/#.#g'); do
  echo "== $c"; javap -p -c -classpath "$CP" "$c" \
    | grep -nE 'getPreviewSize|getPreviewOutputSize|closestTo|setPreview|startPreview|Surface|OutputConfiguration|createCaptureSession|SessionConfiguration|setDefaultBufferSize|setFixedSize'
done
```

- **Where the size is computed.** `CameraSource.getPreviewSize` is
  `CameraSizes.getPreviewOutputSize(manager.getCameraCharacteristics(getCameraId()), targetSize, targetClass)`, which
  reads `SCALER_STREAM_CONFIGURATION_MAP.getOutputSizes(targetClass)`, sorts by area, reverses, and calls
  `SizeExtensionsKt.closestTo`: the area-only rule `PreviewSizes.vendorPick` copies.
- **The surface sets the size.** `CameraSource.setPreview(surface)` wraps it as `CameraSurface(name, surface)` and
  calls `CameraController.addOutput`. The session is made from the surfaces alone:
  `CameraExecutorCaptureSessionCompat.createCaptureSession` builds `new OutputConfiguration(Surface)` for each and
  calls `CameraDevice.createCaptureSession(SessionConfiguration)`; `CameraHandlerCaptureSessionCompat` calls
  `CameraDevice.createCaptureSession(List<Surface>, …)`. Neither passes a size, so Camera2 takes each stream's size
  from its surface.
- **The surface's size is the request's.** In `viewfinder-view` 1.4.0-alpha13,
  `SurfaceViewImplementation$SurfaceRequestCallback` calls `SurfaceHolder.setFixedSize(width, height)` with
  `ViewfinderSurfaceRequest.getResolution()`, and `TextureViewImplementation` calls
  `SurfaceTexture.setDefaultBufferSize(width, height)` with the same.

So the chain is: the decorator's `getPreviewSize` answer → `ViewfinderSurfaceRequest.Builder(Size)` → the surface's
buffer size → `OutputConfiguration(Surface)` → the camera's preview stream. Nothing in it re-picks a size.

## 5. The fallback

Not needed: steps 2 and 4 do not rule the decorator out. For the record, `androidx.camera.viewfinder` reaches the app
only as `streampack-ui`'s runtime dependency, and `IPreviewableSource.setPreview(Surface)` / `startPreview(Surface)`
are public, so a viewfinder of our own remains the next option if the device disagrees.

## 6. What the decorator must do (input to Task 3.3)

- Answer `getPreviewSize` with the 16:9 pick when the camera lists a 16:9 size, and the real source's answer
  otherwise; forward every other member of `ICameraSource` to the real source.
- Show the `PreviewView` a provider whose `videoInput.sourceFlow` carries the decorated camera, and leave the
  streamer's own input untouched, so attaching or detaching the preview never reaches the encode (P2).
- Keep one decorator per real source and one provider per real streamer. `PreviewView` compares the new streamer with
  the one it holds (`Intrinsics.areEqual`, "Streamer already set", `setVideoSourceProvider$2` offset 167) and each
  source with the one before it ("No change in video source", `collectSource$1$1` offset 20), and our wrappers do not
  override `equals`, so the test is identity. A fresh wrapper for the same camera would read as a new source, and the
  old one would be stopped, reset and released (`collectSource$1$1$1` offsets 52–307) although it is the same camera.

## Verdict

`DECORATOR`: (a), (b) and (c) hold; the flow's element type is the public `IVideoSource`; every member is public and
delegable; the session uses the surface it is given. Task 3.3 proceeds.

Device-only (Batch 9): that the CPH2569's preview stream becomes 1280 × 720 in `dumpsys media.camera`, and that the
camera box shows no pillarbox.

## Addendum (Task 3.3): implementing the camera needs an opt-in

Found while building the decorator, after the verdict above. `javap -v` shows two of the five interfaces carry
`kotlin.SubclassOptInRequired(markerClass = [InternalStreamPackApi])`: `ICameraSource` and `IPreviewableSource`.
`IVideoSource`, `IWithVideoSource` and `IVideoInput` carry none. `InternalStreamPackApi` is
`kotlin.RequiresOptIn(level = ERROR, message = "This is an internal StreamPack API. It is not intended for public use
and can change without notice.")`. (`javap -p` hides annotations; `-v` shows them.)

So a class that implements `ICameraSource` does not compile without `@OptIn(InternalStreamPackApi::class)`. Calling
the interfaces needs no opt-in, only implementing them. This changes no condition of the verdict: the members and
their types are public, and the opt-in is a compile-time marker, not a fork or a re-pin. The glue already implements
`IEndpointInternal` under the same opt-in (`CountingEndpoint`, `RoutingEndpoint`, `CaptureEndpointFactory`). What it
does mean: StreamPack says these interfaces can change without notice, so a bump of the strict 3.2.1 pin re-reads
them, which `PreviewFit.STREAMPACK`'s pin in `GlueRulesTest` already forces.

The decorator compiles with Kotlin 2.3.0 (the app's) against the 3.2.1 jars and `android.jar` 37, and its bytecode
forwards every member it does not replace to the real source, the default `startPreview(Surface)` included
(`invokeinterface ICameraSource.startPreview:(Landroid/view/Surface;…)`). The full Android build is not run in this
worktree; the device check (Batch 9) runs it.
