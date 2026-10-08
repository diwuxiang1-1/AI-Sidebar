// ============================================================
// AI Sidebar · 界面语言(完整版 · 新增)
// ------------------------------------------------------------
// 只做一件事:把「界面/提示文案」翻译成用户选的语言。
//
// ⚠️ 与「网页翻译目标语言」完全是两件事,不要混:
//     使用者语言(这里) —— 你自己看到的界面语言
//     翻译目标语言     —— utils/translate.js 里的 TRANSLATE_LANGS
//     「界面中文 + 网页翻译成日文」是合法组合。
//
// 设计取舍(保持现有架构):
//   · 经典脚本,挂在全局作用域,页面用 <script> 加载
//   · 不引入任何 i18n 框架、不做动态加载
//   · 只用一张紧凑表:LANG_ORDER 决定各语言在数组里的位置
//   · 没翻译到的 key 一律回落中文 —— 绝不显示成空白或 key 名
// ============================================================

"use strict";

var I18N_KEY = "ai-sidebar:ui-config";

/** 支持的语言(id 用 BCP-47 风格,名称用该语言自己的写法) */
var I18N_LANGS = [
  { id: "zh-CN", name: "简体中文" },
  { id: "en",    name: "English" },
  { id: "ja",    name: "日本語" },
  { id: "ko",    name: "한국어" },
  { id: "fr",    name: "Français" },
  { id: "de",    name: "Deutsch" },
  { id: "es",    name: "Español" },
  { id: "ru",    name: "Русский" },
];

var I18N_DEFAULT = "zh-CN";

/* ------------------------------------------------------------------
   文案表
   每行: "key": ["zh-CN", "en", "ja", "ko", "fr", "de", "es", "ru"]
   顺序必须与 I18N_LANGS 一致。
   ------------------------------------------------------------------ */
var I18N_TABLE = {
  /* 顶部 / 页面 */
  "app.title":        ["AI Sidebar", "AI Sidebar", "AI Sidebar", "AI Sidebar", "AI Sidebar", "AI Sidebar", "AI Sidebar", "AI Sidebar"],
  "app.settings":     ["设置", "Settings", "設定", "설정", "Paramètres", "Einstellungen", "Ajustes", "Настройки"],
  /* ❤️ 支持项目:emoji 写进文案里,因为 applyI18n 会整体替换 textContent */
  "app.support":      ["❤️ 支持项目", "❤️ Support", "❤️ 支援", "❤️ 후원", "❤️ Soutenir", "❤️ Unterstützen", "❤️ Apoyar", "❤️ Поддержать"],
  "support.title":    ["❤️ 支持项目", "❤️ Support this project", "❤️ プロジェクトを支援", "❤️ 프로젝트 후원", "❤️ Soutenir le projet", "❤️ Projekt unterstützen", "❤️ Apoyar el proyecto", "❤️ Поддержать проект"],
  "support.text":     [
    "这个扩展完全免费,也没有任何后端。如果它帮到了你,可以请作者喝杯咖啡 —— 完全自愿,不影响任何功能。",
    "This extension is completely free and has no backend. If it helps you, you can buy the author a coffee — entirely optional, and no feature depends on it.",
    "この拡張機能は完全に無料で、バックエンドもありません。役に立ったら作者にコーヒーをおごってください —— 完全に任意で、機能には一切影響しません。",
    "이 확장 프로그램은 완전히 무료이며 백엔드도 없습니다. 도움이 되었다면 작성자에게 커피 한 잔을 —— 전적으로 자발적이며 어떤 기능에도 영향을 주지 않습니다.",
    "Cette extension est entièrement gratuite et sans backend. Si elle vous aide, vous pouvez offrir un café à l'auteur — entièrement facultatif, sans effet sur les fonctionnalités.",
    "Diese Erweiterung ist völlig kostenlos und hat kein Backend. Wenn sie dir hilft, kannst du dem Autor einen Kaffee spendieren — völlig freiwillig und ohne Einfluss auf Funktionen.",
    "Esta extensión es totalmente gratuita y no tiene backend. Si te resulta útil, puedes invitar al autor a un café — totalmente opcional y sin afectar a ninguna función.",
    "Это расширение полностью бесплатно и не имеет бэкенда. Если оно вам помогло, можно угостить автора кофе — совершенно добровольно и без влияния на функции.",
  ],
  "support.note":     [
    "捐赠页面会在新标签页打开,扩展不经手任何支付信息。",
    "The donation page opens in a new tab. The extension never handles any payment information.",
    "寄付ページは新しいタブで開きます。拡張機能は支払い情報を一切扱いません。",
    "후원 페이지는 새 탭에서 열립니다. 이 확장 프로그램은 결제 정보를 전혀 다루지 않습니다.",
    "La page de don s'ouvre dans un nouvel onglet. L'extension ne traite aucune information de paiement.",
    "Die Spenden-Seite öffnet sich in einem neuen Tab. Die Erweiterung verarbeitet keine Zahlungsdaten.",
    "La página de donación se abre en una pestaña nueva. La extensión no gestiona ningún dato de pago.",
    "Страница доната откроется в новой вкладке. Расширение не обрабатывает платёжные данные.",
  ],
  "page.chat":        ["聊天", "Chat", "チャット", "채팅", "Discussion", "Chat", "Chat", "Чат"],
  "page.resources":   ["网页资源", "Resources", "ページリソース", "페이지 리소스", "Ressources", "Ressourcen", "Recursos", "Ресурсы"],

  /* 模式 */
  "mode.normal":      ["普通聊天", "Normal chat", "通常チャット", "일반 채팅", "Chat normal", "Normaler Chat", "Chat normal", "Обычный чат"],
  "mode.page":        ["当前网页", "Current page", "現在のページ", "현재 페이지", "Page actuelle", "Aktuelle Seite", "Página actual", "Текущая страница"],

  /* 工具栏 */
  "tool.newChat":     ["新聊天", "New chat", "新しいチャット", "새 채팅", "Nouveau chat", "Neuer Chat", "Chat nuevo", "Новый чат"],
  "tool.history":     ["历史", "History", "履歴", "기록", "Historique", "Verlauf", "Historial", "История"],
  "tool.currentPage": ["当前网页", "Current page", "現在のページ", "현재 페이지", "Page actuelle", "Aktuelle Seite", "Página actual", "Текущая страница"],
  "tool.fullText":    ["读取完整网页", "Read full page", "ページ全文を読む", "전체 페이지 읽기", "Lire toute la page", "Ganze Seite lesen", "Leer página completa", "Читать всю страницу"],
  "tool.translate":   ["网页翻译", "Translate page", "ページ翻訳", "페이지 번역", "Traduire la page", "Seite übersetzen", "Traducir página", "Перевести страницу"],
  "tool.patch":       ["修改网页", "Edit page", "ページを編集", "페이지 편집", "Modifier la page", "Seite bearbeiten", "Editar página", "Изменить страницу"],

  /* 目标栏 */
  "target.label":     ["AI 当前操作目标", "AI is operating on", "AI の操作対象", "AI 작업 대상", "Cible actuelle de l'IA", "Aktuelles KI-Ziel", "Objetivo actual de la IA", "Текущая цель ИИ"],
  "target.active":    ["当前活动网页", "Active page", "現在のアクティブページ", "현재 활성 페이지", "Page active", "Aktive Seite", "Página activa", "Активная страница"],
  "target.lock":      ["锁定此网页", "Lock this page", "このページを固定", "이 페이지 고정", "Verrouiller cette page", "Diese Seite fixieren", "Fijar esta página", "Закрепить страницу"],
  "target.lockedN":   ["已锁定", "Locked", "固定済み", "고정됨", "Verrouillées", "Fixiert", "Fijadas", "Закреплено"],
  "target.panel":     ["已锁定的网页", "Locked pages", "固定したページ", "고정된 페이지", "Pages verrouillées", "Fixierte Seiten", "Páginas fijadas", "Закреплённые страницы"],
  "target.refresh":   ["刷新状态", "Refresh", "状態を更新", "상태 새로고침", "Actualiser", "Aktualisieren", "Actualizar", "Обновить"],
  "target.operate":   ["操作", "Use", "操作", "사용", "Utiliser", "Verwenden", "Usar", "Использовать"],
  "target.setActive": ["设为操作目标", "Set as target", "対象に設定", "대상으로 설정", "Définir comme cible", "Als Ziel setzen", "Usar como objetivo", "Сделать целью"],
  "target.confirm":   ["重新确认此目标", "Re-confirm", "再確認", "다시 확인", "Reconfirmer", "Neu bestätigen", "Reconfirmar", "Подтвердить снова"],
  "target.release":   ["解除", "Unlock", "解除", "해제", "Déverrouiller", "Lösen", "Liberar", "Снять"],
  "target.reanalyze": ["重新分析网页", "Re-analyze", "再分析", "다시 분석", "Réanalyser", "Neu analysieren", "Reanalizar", "Переанализировать"],
  "target.clearPlan": ["清除该网页修改", "Clear page edits", "このページの変更を消去", "페이지 수정 지우기", "Effacer les modifications", "Änderungen löschen", "Borrar cambios", "Очистить изменения"],

  /* 翻译面板 */
  "tr.title":         ["网页翻译", "Page translation", "ページ翻訳", "페이지 번역", "Traduction", "Übersetzung", "Traducción", "Перевод"],
  "tr.lang":          ["目标语言", "Target language", "翻訳先の言語", "번역 언어", "Langue cible", "Zielsprache", "Idioma destino", "Целевой язык"],
  "tr.mode":          ["翻译方式", "Style", "翻訳スタイル", "번역 방식", "Style", "Stil", "Estilo", "Стиль"],
  "tr.start":         ["翻译网页", "Translate", "翻訳する", "번역", "Traduire", "Übersetzen", "Traducir", "Перевести"],
  "tr.stop":          ["停止", "Stop", "停止", "중지", "Arrêter", "Stopp", "Detener", "Стоп"],
  "tr.restore":       ["恢复原文", "Restore original", "原文に戻す", "원문 복원", "Restaurer", "Original wiederherstellen", "Restaurar original", "Восстановить"],

  /* 修改面板 */
  "patch.title":      ["AI 修改网页", "AI page edit", "AI ページ編集", "AI 페이지 편집", "Édition IA", "KI-Seitenbearbeitung", "Edición IA", "ИИ-редактирование"],
  "patch.apply":      ["执行网页修改", "Apply edit", "編集を実行", "편집 실행", "Appliquer", "Anwenden", "Aplicar", "Применить"],
  "patch.deep":       ["深度分析网页", "Deep analyze", "詳細分析", "심층 분석", "Analyse avancée", "Tiefenanalyse", "Análisis profundo", "Глубокий анализ"],
  "patch.undo":       ["撤销", "Undo", "元に戻す", "실행 취소", "Annuler", "Rückgängig", "Deshacer", "Отменить"],
  "patch.restorePage":["恢复网页", "Restore page", "ページを復元", "페이지 복원", "Restaurer la page", "Seite wiederherstellen", "Restaurar página", "Восстановить страницу"],
  "patch.audit":      ["操作记录", "Activity log", "操作ログ", "작업 기록", "Journal", "Protokoll", "Registro", "Журнал"],

  /* 输入区 */
  "input.placeholder":["输入消息,Enter 发送,Shift+Enter 换行", "Type a message. Enter to send, Shift+Enter for a new line", "メッセージを入力(Enter で送信、Shift+Enter で改行)", "메시지 입력(Enter 전송, Shift+Enter 줄바꿈)", "Saisissez un message. Entrée pour envoyer, Maj+Entrée pour un saut de ligne", "Nachricht eingeben. Enter sendet, Umschalt+Enter für Zeilenumbruch", "Escribe un mensaje. Enter envía, Mayús+Enter salta de línea", "Введите сообщение. Enter — отправить, Shift+Enter — новая строка"],
  "input.send":       ["发送", "Send", "送信", "전송", "Envoyer", "Senden", "Enviar", "Отправить"],
  "input.stop":       ["停止", "Stop", "停止", "중지", "Arrêter", "Stopp", "Detener", "Стоп"],
  "input.addFile":    ["添加文件", "Add file", "ファイルを追加", "파일 추가", "Ajouter un fichier", "Datei hinzufügen", "Añadir archivo", "Добавить файл"],
  "input.selectedN":  ["已选中 {n} 字", "{n} characters selected", "{n} 文字を選択中", "{n}자 선택됨", "{n} caractères sélectionnés", "{n} Zeichen ausgewählt", "{n} caracteres seleccionados", "Выбрано символов: {n}"],
  "input.clearSel":   ["清除选中文字", "Clear selection", "選択を解除", "선택 해제", "Effacer la sélection", "Auswahl löschen", "Borrar selección", "Очистить выделение"],

  /* 资源页 */
  "res.title":        ["网页资源", "Page resources", "ページリソース", "페이지 리소스", "Ressources de la page", "Seitenressourcen", "Recursos de la página", "Ресурсы страницы"],
  "res.refresh":      ["刷新", "Refresh", "更新", "새로고침", "Actualiser", "Aktualisieren", "Actualizar", "Обновить"],
  "res.images":       ["图片", "Images", "画像", "이미지", "Images", "Bilder", "Imágenes", "Изображения"],
  "res.links":        ["链接", "Links", "リンク", "링크", "Liens", "Links", "Enlaces", "Ссылки"],
  "res.videos":       ["视频", "Videos", "動画", "동영상", "Vidéos", "Videos", "Vídeos", "Видео"],
  "res.audios":       ["音频", "Audio", "音声", "오디오", "Audio", "Audio", "Audio", "Аудио"],
  "res.open":         ["打开", "Open", "開く", "열기", "Ouvrir", "Öffnen", "Abrir", "Открыть"],
  "res.copy":         ["复制", "Copy", "コピー", "복사", "Copier", "Kopieren", "Copiar", "Копировать"],
  "res.download":     ["下载", "Download", "ダウンロード", "다운로드", "Télécharger", "Herunterladen", "Descargar", "Скачать"],
  "res.copied":       ["已复制", "Copied", "コピーしました", "복사됨", "Copié", "Kopiert", "Copiado", "Скопировано"],

  /* 会话 */
  "sess.history":     ["聊天历史", "Chat history", "チャット履歴", "채팅 기록", "Historique", "Chat-Verlauf", "Historial", "История чата"],

  /* 设置页 */
  "set.api":          ["API 配置", "API settings", "API 設定", "API 설정", "Configuration API", "API-Einstellungen", "Configuración de API", "Настройки API"],
  "set.uiLang":       ["使用者语言", "Interface language", "表示言語", "사용자 언어", "Langue de l'interface", "Sprache der Oberfläche", "Idioma de la interfaz", "Язык интерфейса"],
  "set.context":      ["上下文管理", "Context", "コンテキスト", "컨텍스트", "Contexte", "Kontext", "Contexto", "Контекст"],
  "set.perms":        ["AI 权限", "AI permissions", "AI 権限", "AI 권한", "Autorisations IA", "KI-Berechtigungen", "Permisos de IA", "Права ИИ"],

  /* 常用状态与错误 */
  "msg.noApiKey":     ["请先配置 API Key", "Please configure an API key first", "先に API キーを設定してください", "먼저 API 키를 설정하세요", "Configurez d'abord une clé API", "Bitte zuerst einen API-Schlüssel konfigurieren", "Configura primero una clave de API", "Сначала настройте API-ключ"],
  "msg.noModel":      ["请先配置模型", "Please configure a model first", "先にモデルを設定してください", "먼저 모델을 설정하세요", "Configurez d'abord un modèle", "Bitte zuerst ein Modell konfigurieren", "Configura primero un modelo", "Сначала настройте модель"],
  "msg.stopped":      ["已停止。", "Stopped.", "停止しました。", "중지되었습니다.", "Arrêté.", "Gestoppt.", "Detenido.", "Остановлено."],
  "msg.needPerm":     ["当前权限不足,请在设置中开启对应权限。", "Insufficient permission. Enable it in Settings.", "権限が不足しています。設定で有効にしてください。", "권한이 부족합니다. 설정에서 활성화하세요.", "Autorisation insuffisante. Activez-la dans les paramètres.", "Unzureichende Berechtigung. Bitte in den Einstellungen aktivieren.", "Permiso insuficiente. Actívalo en Ajustes.", "Недостаточно прав. Включите их в настройках."],
};

/* ==================================================================
   1. 取值
   ================================================================== */

function i18nLangIndex(lang) {
  for (var i = 0; i < I18N_LANGS.length; i++) {
    if (I18N_LANGS[i].id === lang) return i;
  }
  return 0;   // 未知语言 → 中文
}

/** 当前语言(同步缓存,由 setCurrentLang 维护) */
var I18N_CURRENT = I18N_DEFAULT;

function setCurrentLang(lang) {
  I18N_CURRENT = (i18nLangIndex(lang) === 0 && lang !== I18N_DEFAULT) ? I18N_DEFAULT : lang;
  if (i18nLangIndex(I18N_CURRENT) === 0 && I18N_CURRENT !== I18N_DEFAULT) I18N_CURRENT = I18N_DEFAULT;
  return I18N_CURRENT;
}

function getCurrentLang() {
  return I18N_CURRENT;
}

/**
 * 取一条文案
 * @param {string} key
 * @param {object} [vars] 形如 {n: 12} → 替换文案里的 {n}
 */
function t(key, vars) {
  var row = I18N_TABLE[key];
  var text = row ? row[i18nLangIndex(I18N_CURRENT)] : null;

  // 没有翻译 → 回落中文;再没有 → 显示 key(方便发现漏翻,但不至于空白)
  if (!text) text = row ? row[0] : key;
  if (!text) text = key;

  if (vars) {
    for (var k in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, k)) {
        text = text.split("{" + k + "}").join(String(vars[k]));
      }
    }
  }
  return text;
}

/* ==================================================================
   2. 读写设置
   ================================================================== */

async function getUiLang() {
  try {
    var data = await chrome.storage.local.get(I18N_KEY);
    var stored = data[I18N_KEY];
    var lang = stored && stored.lang;
    if (!lang || i18nLangIndex(lang) === 0 && lang !== I18N_DEFAULT) return I18N_DEFAULT;
    return lang;
  } catch (e) {
    return I18N_DEFAULT;
  }
}

async function saveUiLang(lang) {
  var obj = {};
  obj[I18N_KEY] = { lang: lang };
  await chrome.storage.local.set(obj);
  setCurrentLang(lang);
  return lang;
}

/* ==================================================================
   3. 套用到界面
   ------------------------------------------------------------------
   支持三种标记:
     data-i18n              → textContent
     data-i18n-title        → title
     data-i18n-placeholder  → placeholder
   没有标记的元素原样保留(所以「不破坏中文界面」是天然成立的)
   ================================================================== */

function applyI18n(root, lang) {
  if (lang) setCurrentLang(lang);
  if (!root || !root.querySelectorAll) return;

  var nodes = root.querySelectorAll("[data-i18n]");
  for (var i = 0; i < nodes.length; i++) {
    var key = nodes[i].getAttribute("data-i18n");
    if (key) nodes[i].textContent = t(key);
  }

  var titled = root.querySelectorAll("[data-i18n-title]");
  for (var j = 0; j < titled.length; j++) {
    var tk = titled[j].getAttribute("data-i18n-title");
    if (tk) titled[j].title = t(tk);
  }

  var phs = root.querySelectorAll("[data-i18n-placeholder]");
  for (var m = 0; m < phs.length; m++) {
    var pk = phs[m].getAttribute("data-i18n-placeholder");
    if (pk) phs[m].placeholder = t(pk);
  }
}

/** 语言名(用于「请用某语言回答」这类提示) */
function langDisplayName(lang) {
  var i = i18nLangIndex(lang || I18N_CURRENT);
  return I18N_LANGS[i].name;
}

/**
 * 给模型的「回复语言」要求
 * 只在开着「当前网页」等需要 AI 主动作答的场景用,不影响网页翻译。
 */
function buildLanguageNote() {
  var name = langDisplayName(I18N_CURRENT);
  return "【回复语言】请始终使用「" + name + "」回答用户(代码、专有名词、原文引用可以保留原样)。";
}
