# Final review M6. Read by an app that minifies (R8); the release build does not today.
#
# AudioSessionIds reads StreamPack's private `audioRecord` field by its name, by reflection, walking up
# from MicrophoneSource to the class that declares it (3.2.1, javap). Renamed or removed by R8, MicWatch
# would hear nothing and each opening would write `watch-failed {action: "mic-session"}`. GlueRulesTest
# holds the field's name here to the name AudioSessionIds reads.
-keepclassmembers class io.github.thibaultbee.streampack.core.elements.sources.audio.audiorecord.AudioRecordSource {
    private android.media.AudioRecord audioRecord;
}
