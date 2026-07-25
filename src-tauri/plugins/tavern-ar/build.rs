fn main() {
    // 注册命令名，让 tauri-plugin 在编译时自动生成对应的 `allow-<command>` 权限。
    // 命令名必须与 ArPlugin.kt 中 @Command 注解的方法名（转为 snake_case）一致：
    //   checkArAvailability       -> check_ar_availability
    //   launchAr                  -> launch_ar
    //   closeAr                   -> close_ar
    //   updateCharacterTexture    -> update_character_texture
    //   updateRenderState         -> update_render_state
    //   updateChatBubble          -> update_chat_bubble
    // 实际命令处理在 Kotlin 端（通过 register_android_plugin 路由），
    // Rust 端仅用这些名称生成权限 schema，不提供命令实现。
    tauri_plugin::Builder::new(&[
        "check_ar_availability",
        "launch_ar",
        "close_ar",
        "update_character_texture",
        "update_render_state",
        "update_chat_bubble",
        "set_gesture_recognition",
        "check_gesture_recognition_ready",
    ])
    .android_path("android")
    .build();
}
