# 星穹对决示例插件

这是一个面向移动端横屏的短局对战示例，用于展示全屏插件不仅能承载 Gal 游戏，也能实现完整游戏循环。

## 展示能力

- 三种技能、能量管理和敌方意图预告
- 敌方 AI、护盾、穿透伤害及胜负结算
- Canvas 粒子效果、CSS 动画和 Web Audio 即时音效
- 局内断点续战、最佳回合与连胜记录
- 横屏适配、Safe Area 避让和触屏操作
- 无网络、无第三方运行时、无主应用数据访问

直接打开 `index.html` 可进入独立预览模式；通过 Mobile Tavern 运行时会自动改用宿主提供的隔离存档和退出能力。

## 制作安装包

在当前目录执行：

```powershell
tar.exe -a -c -f astral-arena.zip manifest.json index.html game.js style.css assets
Rename-Item astral-arena.zip astral-arena.mtplugin
```

不要使用 Windows PowerShell 的 `Compress-Archive` 打包包含子目录的插件；它可能在 ZIP 中写入反斜杠路径，安全解析器会拒绝该包。

生成的 `astral-arena.mtplugin` 可在“设置 → 高级设置 → 第三方插件”中安装。

背景图使用内置 `imagegen` 工具生成，角色单位、动画和交互反馈均由插件自身实时绘制。
