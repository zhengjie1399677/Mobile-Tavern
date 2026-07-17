export const TRANSLATIONS: Record<string, Record<string, string>> = {
  "zh-CN": {
    "control_panel.title": "控制面板",
    "control_panel.subtitle": "系统参数与颗粒化规则调节",
    "control_panel.check_update": "检查更新",
    "control_panel.checking": "检查中",
    
    "tabs.connection": "连接",
    "tabs.features": "功能",
    "tabs.persona": "人设",
    "tabs.storage": "存储",
    
    "sandbox.title": "系统运行沙盒",
    "sandbox.desc": "实时观测 Prompt 编译原理、SSE 流式解析缓冲区以及世界书扫描流程",
    "sandbox.button": "🚀 进入系统运行沙盒 (Sandbox)",
    
    "lang.section_title": "多语言设置",
    "lang.select_label": "应用语言",
    "lang.select_desc": "切换界面语言。首次启动时已根据系统默认语言自动识别。",
    
    "features.section_title": "功能设置",
    "features.cat_rendering": "界面渲染与交互特性",
    
    "features.html_rendering": "富文本 HTML 渲染",
    "features.html_rendering_desc": "允许角色卡使用 HTML/CSS 标签控制对话气泡文本样式。关闭后使用纯文本渲染。",
    
    "features.js_execution": "卡片 JS 脚本执行",
    "features.js_execution_desc": "允许角色卡运行自定义 JS 脚本以展示动态状态面板。运行未知脚本具有一定安全风险。",
    
    "features.loop_protection": "脚本循环安全监视器",
    "features.loop_protection_desc": "自动对卡片脚本中的死循环织入时间监视器，防止界面挂起卡死。单次循环上限 1000ms。",
    
    "features.ambient_glow": "环境光感应联动",
    "features.ambient_glow_experimental": "实验性",
    "features.ambient_glow_desc": "根据角色当前的情绪与表情，在聊天界面背景渲染流动光晕，提升交互沉浸感。",
    
    "features.reasoning_display": "思维链显示",
    "features.reasoning_display_desc": "显示或隐藏 AI 回复中的思考过程。关闭后仅隐藏思考卡片，不影响模型本身生成。",
    
    "features.message_queue": "多消息排队合并发送",
    "features.message_queue_plugin": "插件",
    "features.message_queue_desc": "开启后，点击发送仅排队不回复；长按发送 (500ms+) 将合并发送并触发 AI 回复。",
    
    "features.asterisk_formatting": "星号动作分色渲染",
    "features.asterisk_formatting_desc": "将斜体星号动作描述渲染为灰色。角色卡内独立配置优先。",
    
    "features.bison_mode": "野牛模式",
    "features.bison_mode_token_warning": "Token 消耗增加",
    "features.bison_mode_desc": "开启后，AI 将根据情绪概率锁定输入框并连续输出 2-3 次（单次最大限制 100 Token）。",
    "features.bison_mode_warning": "⚠️ 开启后将产生连续 API 请求，可能会显著增加 Token 消耗。",
    "features.bison_mode_prompt_title": "自定义野牛提示词指令",
    "features.reset_default": "重置为系统默认",
    
    "features.reply_suggestions": "叙事分支生成器",
    "features.reply_suggestions_desc": "生成回复时附带后续剧情分支选项，点击可快速输入或发送。",
    "features.click_mode": "默认点击行为",
    "features.click_mode_fill": "填入输入框",
    "features.click_mode_send": "直接发送",
    "features.suggestions_prompt_title": "分支生成引导指令",
    "features.expression_dict_title": "情绪匹配正则词典",
    "features.expression_dict_desc": "当角色未配置 triggers 时，系统使用此正则词典匹配表情变化（可清空关闭）。",
    "features.reset_dict": "重置词典",
  },
  "zh-TW": {
    "control_panel.title": "控制面板",
    "control_panel.subtitle": "系統參數與顆粒化規則調節",
    "control_panel.check_update": "檢查更新",
    "control_panel.checking": "檢查中",
    
    "tabs.connection": "連線",
    "tabs.features": "功能",
    "tabs.persona": "人設",
    "tabs.storage": "儲存",
    
    "sandbox.title": "系統運行沙盒",
    "sandbox.desc": "實時觀測 Prompt 編譯原理、SSE 流式解析緩衝區以及世界書掃描流程",
    "sandbox.button": "🚀 進入系統運行沙盒 (Sandbox)",
    
    "lang.section_title": "多語言設置",
    "lang.select_label": "應用語言",
    "lang.select_desc": "切換介面語言。首次啟動時已根據系統預設語言自動識別。",
    
    "features.section_title": "功能設置",
    "features.cat_rendering": "介面渲染與交互特性",
    
    "features.html_rendering": "富文本 HTML 渲染",
    "features.html_rendering_desc": "允許角色卡使用 HTML/CSS 標籤控制對話氣泡文本樣式。關閉後使用純文本渲染。",
    
    "features.js_execution": "卡片 JS 腳本執行",
    "features.js_execution_desc": "允許角色卡運行自定義 JS 腳本以展示動態狀態面板。運行未知腳本具有一定安全風險。",
    
    "features.loop_protection": "腳本循環安全監視器",
    "features.loop_protection_desc": "自動對卡片腳本中的死循環織入時間監視器，防止介面掛起卡死。單次循環上限 1000ms。",
    
    "features.ambient_glow": "環境光感應連動",
    "features.ambient_glow_experimental": "實驗性",
    "features.ambient_glow_desc": "根據角色當前的情緒與表情，在聊天介面背景渲染流動光暈，提升交互沉浸感。",
    
    "features.reasoning_display": "思維鏈顯示",
    "features.reasoning_display_desc": "顯示或隱藏 AI 回覆中的思考過程。關閉後僅隱藏思考卡片，不影響模型本身生成。",
    
    "features.message_queue": "多訊息排隊合併發送",
    "features.message_queue_plugin": "外掛",
    "features.message_queue_desc": "開啟後，點擊發送僅排隊不回覆；長按發送 (500ms+) 將合併發送並觸發 AI 回覆。",
    
    "features.asterisk_formatting": "星號動作分色渲染",
    "features.asterisk_formatting_desc": "將斜體星號動作描述渲染為灰色。角色卡內獨立配置優先。",
    
    "features.bison_mode": "野牛模式",
    "features.bison_mode_token_warning": "Token 消耗增加",
    "features.bison_mode_desc": "開啟後，AI 將根據情緒機率鎖定輸入框並連續輸出 2-3 次（單次最大限制 100 Token）。",
    "features.bison_mode_warning": "⚠️ 開啟後將產生連續 API 請求，可能會顯著增加 Token 消耗。",
    "features.bison_mode_prompt_title": "自定義野牛提示詞指令",
    "features.reset_default": "重置為系統預設",
    
    "features.reply_suggestions": "敘事分支生成器",
    "features.reply_suggestions_desc": "生成回覆時附帶後續劇情分支選項，點擊可快速輸入或發送。",
    "features.click_mode": "預設點擊行為",
    "features.click_mode_fill": "填入輸入框",
    "features.click_mode_send": "直接發送",
    "features.suggestions_prompt_title": "分支生成引導指令",
    "features.expression_dict_title": "情緒匹配正則詞典",
    "features.expression_dict_desc": "當角色未配置 triggers 時，系統使用此正則詞典匹配表情變化（可清空關閉）。",
    "features.reset_dict": "重置詞典",
  },
  "en": {
    "control_panel.title": "Control Panel",
    "control_panel.subtitle": "Adjust system settings and granular pipeline rules",
    "control_panel.check_update": "Updates",
    "control_panel.checking": "Checking",
    
    "tabs.connection": "Connect",
    "tabs.features": "Features",
    "tabs.persona": "Persona",
    "tabs.storage": "Storage",
    
    "sandbox.title": "Developer Sandbox",
    "sandbox.desc": "Inspect prompt compilation, SSE buffer parsing, and worldbook scanning",
    "sandbox.button": "🚀 Enter Developer Sandbox",
    
    "lang.section_title": "Language Settings",
    "lang.select_label": "App Language",
    "lang.select_desc": "Switch interface language. Automatically set to your system default on first startup.",
    
    "features.section_title": "Application Features",
    "features.cat_rendering": "UI Rendering & Interaction",
    
    "features.html_rendering": "Rich Text HTML Rendering",
    "features.html_rendering_desc": "Allow character cards to style dialogue bubbles using HTML/CSS tags. Fallback to plain text if disabled.",
    
    "features.js_execution": "Card JS Script Execution",
    "features.js_execution_desc": "Allow character cards to run custom JS in sandbox to show dynamic status panels. Execution carries security risks.",
    
    "features.loop_protection": "Script Loop Protection",
    "features.loop_protection_desc": "Inject watchdog timers into script loops to prevent WebView locks. Execution limit: 1000ms.",
    
    "features.ambient_glow": "Emotion Ambient Glow",
    "features.ambient_glow_experimental": "Beta",
    "features.ambient_glow_desc": "Render flow glows in chat background matching the character's expression and emotion to raise immersion.",
    
    "features.reasoning_display": "Reasoning Display",
    "features.reasoning_display_desc": "Show or hide thinking chain (reasoning_content). Hiding it doesn't affect model generation.",
    
    "features.message_queue": "Multi-Message Queue",
    "features.message_queue_plugin": "Plugin",
    "features.message_queue_desc": "Clicking Send queues message without reply; Long-pressing (500ms+) merges queued messages and triggers reply.",
    
    "features.asterisk_formatting": "Asterisk Formatting",
    "features.asterisk_formatting_desc": "Render *action description* in soft italic grey. Character visual settings override this.",
    
    "features.bison_mode": "Bison Mode",
    "features.bison_mode_token_warning": "High Token Cost",
    "features.bison_mode_desc": "Let AI queue and output 2-3 consecutive replies based on emotion (each capped at 100 tokens).",
    "features.bison_mode_warning": "⚠️ This generates consecutive API requests and can significantly increase token consumption.",
    "features.bison_mode_prompt_title": "Bison Mode Prompt Template",
    "features.reset_default": "Reset to Default",
    
    "features.reply_suggestions": "AI Reply Suggestions",
    "features.reply_suggestions_desc": "Generate subsequent story branch options. Click to fill or send.",
    "features.click_mode": "Default Click Action",
    "features.click_mode_fill": "Fill Input Box",
    "features.click_mode_send": "Send Directly",
    "features.suggestions_prompt_title": "Suggestions Prompt Template",
    "features.expression_dict_title": "Emotion Matching Regex Dictionary",
    "features.expression_dict_desc": "Fallback regex to match expressions when card has no triggers (clear to disable).",
    "features.reset_dict": "Reset Dictionary",
  },
  "ja": {
    "control_panel.title": "コントロールパネル",
    "control_panel.subtitle": "システム設定と詳細な規則の調整",
    "control_panel.check_update": "更新確認",
    "control_panel.checking": "確認中",
    
    "tabs.connection": "接続",
    "tabs.features": "機能",
    "tabs.persona": "キャラクター",
    "tabs.storage": "ストレージ",
    
    "sandbox.title": "開発用サンドボックス",
    "sandbox.desc": "プロンプト構築、SSEバッファ解析、および世界設定の動作のリアルタイム監視",
    "sandbox.button": "🚀 サンドボックスに入る (Sandbox)",
    
    "lang.section_title": "言語設定",
    "lang.select_label": "表示言語",
    "lang.select_desc": "表示言語を切り替えます。初回起動時はシステム言語を自動的に検知して適用します。",
    
    "features.section_title": "機能設定",
    "features.cat_rendering": "UIレンダリングとインタラクション",
    
    "features.html_rendering": "リッチテキストHTML描画",
    "features.html_rendering_desc": "キャラクターカードによるHTML/CSSタグを用いた吹き出しの装飾を許可します。無効時はプレーンテキストで描画します。",
    
    "features.js_execution": "カードJSスクリプト実行",
    "features.js_execution_desc": "ステータスパネル表示などのためにキャラクターカード独自のJS実行を許可します。実行には一定のセキュリティリスクがあります。",
    
    "features.loop_protection": "スクリプト無限ループ保護",
    "features.loop_protection_desc": "JSスクリプト内のループ処理にタイムアウト監視を挿入し、フリーズを防止します。ループ上限は1000msです。",
    
    "features.ambient_glow": "感情追従型アンビエント発光",
    "features.ambient_glow_experimental": "実験的",
    "features.ambient_glow_desc": "キャラクターの現在の感情や表情に合わせてチャットの背景に光のグラデーションを描画し、没入感を高めます。",
    
    "features.reasoning_display": "思考プロセスの表示",
    "features.reasoning_display_desc": "AIの返答に含まれる思考の連鎖（reasoning_content）の表示/非表示を切り替えます。非表示にしても生成自体には影響しません。",
    
    "features.message_queue": "複数メッセージの連続送信予約",
    "features.message_queue_plugin": "プラグイン",
    "features.message_queue_desc": "有効にすると、送信ボタン押下時に送信予約のみを行い、ボタン長押し(500ms以上)でまとめて送信してAIの返答をトリガーします。",
    
    "features.asterisk_formatting": "アスタリスク動作の色分け描画",
    "features.asterisk_formatting_desc": "*アスタリスクで囲まれた動作描写* をグレーの斜体で描画します。キャラクター個別の視覚設定が優先されます。",
    
    "features.bison_mode": "バイソンモード",
    "features.bison_mode_token_warning": "トークン消費増",
    "features.bison_mode_desc": "AIが感情状態に応じて入力欄をロックし、2-3回連続で返答を出力します（1回の出力上限は100トークン）。",
    "features.bison_mode_warning": "⚠️ 連続してAPIリクエストを送信するため、トークン消費量が著しく増加する可能性があります。",
    "features.bison_mode_prompt_title": "バイソンモード用プロンプト設定",
    "features.reset_default": "デフォルトに戻す",
    
    "features.reply_suggestions": "ストーリー分岐ジェネレータ",
    "features.reply_suggestions_desc": "返答生成時にストーリー展開の選択肢を提示します。クリックで入力または送信できます。",
    "features.click_mode": "クリック時の動作",
    "features.click_mode_fill": "入力欄に挿入",
    "features.click_mode_send": "直接送信する",
    "features.suggestions_prompt_title": "分岐生成プロンプト設定",
    "features.expression_dict_title": "感情判定正規表現辞書",
    "features.expression_dict_desc": "キャラに triggers がない場合、この正規表现で表情変化を判定します（空にして無効化可）。",
    "features.reset_dict": "辞書リセット",
  },
  "ru": {
    "control_panel.title": "Панель управления",
    "control_panel.subtitle": "Настройка системных параметров и правил конвейера",
    "control_panel.check_update": "Обновления",
    "control_panel.checking": "Проверка",
    
    "tabs.connection": "Связь",
    "tabs.features": "Функции",
    "tabs.persona": "Персона",
    "tabs.storage": "Память",
    
    "sandbox.title": "Песочница разработчика",
    "sandbox.desc": "Анализ компиляции промптов, буфера SSE и сканирования лорбуков",
    "sandbox.button": "🚀 Войти в песочницу (Sandbox)",
    
    "lang.section_title": "Языковые настройки",
    "lang.select_label": "Язык интерфейса",
    "lang.select_desc": "Смена языка приложения. При первом запуске язык определяется автоматически по системе.",
    
    "features.section_title": "Настройки функций",
    "features.cat_rendering": "Отображение и интерфейс",
    
    "features.html_rendering": "Рендеринг HTML/CSS в чате",
    "features.html_rendering_desc": "Разрешить картам персонажей использовать стили HTML/CSS в сообщениях. При отключении используется простой текст.",
    
    "features.js_execution": "Выполнение JS-скриптов карт",
    "features.js_execution_desc": "Разрешить картам запускать кастомный JS для динамических панелей статуса. Запуск несет риски безопасности.",
    
    "features.loop_protection": "Защита от циклов в JS",
    "features.loop_protection_desc": "Автоматическая вставка сторожевых таймеров в циклы скриптов для защиты от зависаний. Лимит: 1000мс.",
    
    "features.ambient_glow": "Эмоциональная подсветка",
    "features.ambient_glow_experimental": "Бета",
    "features.ambient_glow_desc": "Динамическое свечение фона чата, меняющееся в зависимости от текущей эмоции и мимики персонажа.",
    
    "features.reasoning_display": "Показ цепочки рассуждений",
    "features.reasoning_display_desc": "Показывать или скрывать мыслительный процесс AI (reasoning_content). Скрытие не влияет на саму генерацию.",
    
    "features.message_queue": "Очередь сообщений (Очередь)",
    "features.message_queue_plugin": "Плагин",
    "features.message_queue_desc": "Отправка сообщения ставит его в очередь; долгое нажатие (500мс+) объединяет сообщения и запрашивает ответ.",
    
    "features.asterisk_formatting": "Подсветка текста в звёздочках",
    "features.asterisk_formatting_desc": "Вывод текста действия в *звёздочках* серым курсивом. Настройки карты имеют приоритет.",
    
    "features.bison_mode": "Режим Бизона",
    "features.bison_mode_token_warning": "Расход токенов",
    "features.bison_mode_desc": "Позволяет AI отправлять 2-3 ответа подряд в зависимости от эмоции (каждый лимитирован в 100 токенов).",
    "features.bison_mode_warning": "⚠️ Вызывает серию последовательных запросов к API, что значительно повышает расход токенов.",
    "features.bison_mode_prompt_title": "Промпт для режима Бизона",
    "features.reset_default": "Сбросить настройки",
    
    "features.reply_suggestions": "Подсказки сюжета",
    "features.reply_suggestions_desc": "Генерировать варианты развития сюжета. Нажмите, чтобы заполнить или отправить.",
    "features.click_mode": "Действие при нажатии",
    "features.click_mode_fill": "Вставить в поле ввода",
    "features.click_mode_send": "Отправить сразу",
    "features.suggestions_prompt_title": "Шаблон подсказок сюжета",
    "features.expression_dict_title": "Словарь регулярных выражений эмоций",
    "features.expression_dict_desc": "Резервные регулярные выражения для мимики при отсутствии триггеров у карты (очистите для отключения).",
    "features.reset_dict": "Сбросить словарь",
  },
  "es": {
    "control_panel.title": "Panel de Control",
    "control_panel.subtitle": "Ajuste de parámetros y reglas del sistema",
    "control_panel.check_update": "Actualizaciones",
    "control_panel.checking": "Buscando",
    
    "tabs.connection": "Conexión",
    "tabs.features": "Funciones",
    "tabs.persona": "Perfil",
    "tabs.storage": "Memoria",
    
    "sandbox.title": "Caja de Arena de Desarrollo",
    "sandbox.desc": "Inspección de compilación de prompts, búfer SSE y escaneo de lorebooks",
    "sandbox.button": "🚀 Entrar a Caja de Arena (Sandbox)",
    
    "lang.section_title": "Ajustes de Idioma",
    "lang.select_label": "Idioma de la App",
    "lang.select_desc": "Cambiar el idioma de la interfaz. Configurado automáticamente al inicio según tu sistema.",
    
    "features.section_title": "Configuración de Funciones",
    "features.cat_rendering": "Visualización e Interacción",
    
    "features.html_rendering": "Renderizado HTML de Texto",
    "features.html_rendering_desc": "Permite a las cartas usar HTML/CSS para dar formato a los diálogos. Desactivado usa texto plano.",
    
    "features.js_execution": "Ejecución de Scripts JS",
    "features.js_execution_desc": "Permite a las cartas ejecutar JS para mostrar paneles dinámicos. Su ejecución conlleva riesgos de seguridad.",
    
    "features.loop_protection": "Protección de Bucles JS",
    "features.loop_protection_desc": "Inyecta temporizadores en bucles de scripts para evitar bloqueos de la interfaz. Límite: 1000ms.",
    
    "features.ambient_glow": "Brillo Ambiental de Emoción",
    "features.ambient_glow_experimental": "Beta",
    "features.ambient_glow_desc": "Genera flujos de colores en el fondo del chat que cambian según la emoción y expresión del personaje.",
    
    "features.reasoning_display": "Mostrar Pensamiento de IA",
    "features.reasoning_display_desc": "Muestra u oculta el proceso de razonamiento (reasoning_content). Ocultarlo no afecta la generación.",
    
    "features.message_queue": "Cola de Mensajes Múltiples",
    "features.message_queue_plugin": "Plugin",
    "features.message_queue_desc": "Enviar encola el mensaje sin respuesta; Mantener presionado (500ms+) une los mensajes y genera respuesta.",
    
    "features.asterisk_formatting": "Formato de Texto en Asteriscos",
    "features.asterisk_formatting_desc": "Muestra las *acciones en asteriscos* en cursiva gris. La configuración de la carta tiene prioridad.",
    
    "features.bison_mode": "Modo Bisón",
    "features.bison_mode_token_warning": "Alto Consumo",
    "features.bison_mode_desc": "Permite a la IA enviar 2 o 3 respuestas consecutivas según su emoción (límite de 100 tokens cada una).",
    "features.bison_mode_warning": "⚠️ Genera múltiples solicitudes seguidas a la API y puede elevar significativamente el consumo de tokens.",
    "features.bison_mode_prompt_title": "Prompt para Modo Bisón",
    "features.reset_default": "Restablecer valores",
    
    "features.reply_suggestions": "Sugerencias de Trama",
    "features.reply_suggestions_desc": "Generar opciones de continuación de la historia. Clic para rellenar o enviar.",
    "features.click_mode": "Acción por Defecto",
    "features.click_mode_fill": "Rellenar Entrada",
    "features.click_mode_send": "Enviar Directamente",
    "features.suggestions_prompt_title": "Plantilla de Sugerencias de Trama",
    "features.expression_dict_title": "Diccionario de Regex de Emoción",
    "features.expression_dict_desc": "Regex de respaldo para expresiones si la carta no tiene triggers (vaciar para desactivar).",
    "features.reset_dict": "Restablecer Diccionario",
  }
};
