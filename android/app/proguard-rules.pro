# PdfBox-Android: JPEG2000 decoding is an optional dependency we don't ship.
-dontwarn com.gemalto.jp2.**

# ML Kit creates its component registrars by reflection (names from manifest metadata). Its own rule keeps the classes
# but, in R8 full mode, not their constructors, so the components silently vanish (RemoteModelManager.getInstance() was null).
-keep class * implements com.google.firebase.components.ComponentRegistrar { <init>(); }
