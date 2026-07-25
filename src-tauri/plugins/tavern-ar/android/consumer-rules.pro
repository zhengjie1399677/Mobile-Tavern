# Keep ArPlugin and its @Command annotated methods (Tauri invokes them by name).
-keep class com.aitavern.plugin.ar.ArPlugin { *; }
-keep class com.aitavern.plugin.ar.ArActivity { *; }
-keep class com.aitavern.plugin.ar.ArRenderer { *; }
-keep class com.aitavern.plugin.ar.ChatBubbleRenderer { *; }

# Keep ARCore classes (already kept by ARCore's own consumer rules, but explicit for safety).
-keep class com.google.ar.core.** { *; }
