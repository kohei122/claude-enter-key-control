(() => {
const INIT_KEY = "__claudeEnterKeyControlInitialized";
const INIT_MARKER_ATTRIBUTE = "data-claude-enter-key-control-initialized";
if (window[INIT_KEY] || document.documentElement?.hasAttribute(INIT_MARKER_ATTRIBUTE)) return;
window[INIT_KEY] = true;
document.documentElement?.setAttribute(INIT_MARKER_ATTRIBUTE, "true");

function sanitizeMode(mode) {
  return mode === "ctrl" ||
    mode === "cmd" ||
    mode === "both" ||
    mode === "combo" ||
    mode === "shiftCmd"
    ? mode
    : "shift";
}

function sanitizeModeForPlatform(mode, isMac) {
  const sanitized = sanitizeMode(mode);
  if (!isMac && (sanitized === "cmd" || sanitized === "shiftCmd")) {
    return "shift";
  }
  return sanitized;
}

function sanitizeEnabled(enabled) {
  if (enabled === true || enabled === false) return enabled;
  if (enabled === "true") return true;
  if (enabled === "false") return false;
  return true;
}

const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "shift"
};
const DEV_FORCE_MAC_PLATFORM_KEY = "devForceMacPlatform";
const SEND_BUTTON_LABEL_PATTERNS = [
  "メッセージを送信",
  "送信",
  "Send",
  "Send message",
  "Envoyer",
  "Envoyer un message",
  "Enviar",
  "Enviar mensaje",
  "Enviar mensagem",
  "Senden",
  "Nachricht senden",
  "Invia",
  "Invia messaggio",
  "Verzenden",
  "Wyślij",
  "Gönder",
  "Kirim",
  "Gửi",
  "Отправить",
  "Надіслати",
  "메시지 보내기",
  "보내기",
  "전송",
  "发送",
  "发送消息",
  "傳送",
  "傳送訊息",
  "送出"
];
const SEND_BUTTON_LABEL_LOWERCASE_PATTERNS = [
  "send",
  "envoyer",
  "enviar",
  "senden",
  "invia",
  "verzenden",
  "wyślij",
  "gönder",
  "kirim",
  "gửi",
  "отправить",
  "надіслати"
];
const EXCLUDED_BUTTON_LABEL_PATTERNS = [
  "feedback",
  "comment",
  "report",
  "menu",
  "options",
  "microphone",
  "attach",
  "settings",
  "history",
  "フィードバック",
  "コメント",
  "報告",
  "commentaire",
  "commentaires",
  "comentarios",
  "comentário",
  "comentários",
  "의견",
  "피드백",
  "댓글",
  "신고",
  "反馈",
  "评论",
  "举报",
  "意見回饋",
  "回饋",
  "評論",
  "檢舉"
];
const CLAUDE_COMPOSER_ROOT_MAX_DEPTH = 10;
const CLAUDE_COMPOSER_ROOT_MAX_BUTTONS = 8;
const CLAUDE_ATTACHMENT_LABEL_PATTERNS = [
  "add",
  "file",
  "files",
  "connector",
  "connectors",
  "more",
  "aggiungi",
  "connettori",
  "altro"
];
const CLAUDE_MODEL_LABEL_PREFIXES = [
  "model:",
  "modello:"
];
const CLAUDE_RECORD_LABEL_PATTERNS = [
  "record",
  "recording",
  "voice",
  "microphone",
  "press and hold to record",
  "registra",
  "registrare",
  "microfono",
  "tieni premuto per registrare"
];
const CLAUDE_STRONG_SEND_LABELS = [
  "Send message",
  "Invia messaggio"
];

let settings = { ...DEFAULT_SETTINGS };
let settingsLoaded = false;
let isMacPlatform = false;
let isComposingActive = false;
let lastCompositionEndAt = 0;
const COMPOSITION_END_GRACE_MS = 80;

function getIsMacPlatform() {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.getPlatformInfo) {
      resolve(false);
      return;
    }

    chrome.runtime.getPlatformInfo((info) => {
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      resolve(info?.os === "mac");
    });
  });
}

function getDevForceMacPlatform() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [DEV_FORCE_MAC_PLATFORM_KEY]: false }, (stored) => {
      resolve(stored[DEV_FORCE_MAC_PLATFORM_KEY] === true);
    });
  });
}

async function resolveIsMacPlatform() {
  const devForceMacPlatform = await getDevForceMacPlatform();
  if (devForceMacPlatform) return true;
  return getIsMacPlatform();
}

async function loadSettings() {
  isMacPlatform = await resolveIsMacPlatform();

  chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
    const next = {
      enabled: sanitizeEnabled(stored.enabled),
      mode: sanitizeModeForPlatform(stored.mode, isMacPlatform)
    };

    settings = next;
    settingsLoaded = true;
    chrome.storage.local.set(next);
  });
}

loadSettings();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.enabled) {
    settings.enabled = sanitizeEnabled(changes.enabled.newValue);
  }

  if (changes.mode) {
    settings.mode = sanitizeModeForPlatform(changes.mode.newValue, isMacPlatform);
  }

  if (changes[DEV_FORCE_MAC_PLATFORM_KEY]) {
    resolveIsMacPlatform().then((nextIsMacPlatform) => {
      isMacPlatform = nextIsMacPlatform;
      settings.mode = sanitizeModeForPlatform(settings.mode, isMacPlatform);
    });
  }
});

function dispatchEnter(target, options = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    cancelable: true,
    ctrlKey: Boolean(options.ctrlKey),
    metaKey: Boolean(options.metaKey),
    shiftKey: Boolean(options.shiftKey)
  });

  target.dispatchEvent(event);
}

function blockEnterEvent(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function insertClaudeNewline(target) {
  if (!(target instanceof HTMLElement)) return;
  target.focus();
  document.execCommand("insertParagraph");
}

function isVisible(element) {
  return element instanceof HTMLElement && element.getClientRects().length > 0;
}

function normalizeLabel(value) {
  return (value || "").trim().toLowerCase();
}

function hasAnyLabelPattern(label, patterns) {
  const normalizedLabel = normalizeLabel(label);
  return patterns.some((pattern) => normalizedLabel.includes(pattern.toLowerCase()));
}

function isClaudeTextbox(element) {
  if (!(element instanceof HTMLElement)) return false;
  if (element.getAttribute("data-testid") === "chat-input") return true;

  return element.tagName === "DIV" &&
    element.getAttribute("contenteditable") === "true" &&
    element.getAttribute("role") === "textbox";
}

function isTooBroadClaudeRoot(root) {
  if (!(root instanceof HTMLElement)) return true;

  const tagName = root.tagName.toLowerCase();
  return tagName === "html" || tagName === "body" || tagName === "main";
}

function isSelectableClaudeButton(button) {
  return button instanceof HTMLButtonElement &&
    !button.disabled &&
    button.getAttribute("aria-disabled") !== "true" &&
    isVisible(button);
}

function isExcludedClaudeButton(button) {
  if (!(button instanceof HTMLButtonElement)) return true;

  const ariaLabel = button.getAttribute("aria-label") || "";
  const normalizedAriaLabel = normalizeLabel(ariaLabel);
  const hasMenu = button.getAttribute("aria-haspopup") === "menu";
  const isModelSelector = button.getAttribute("data-testid") === "model-selector-dropdown" ||
    CLAUDE_MODEL_LABEL_PREFIXES.some((prefix) => normalizedAriaLabel.startsWith(prefix));
  const isAttachmentMenu = hasMenu && hasAnyLabelPattern(ariaLabel, CLAUDE_ATTACHMENT_LABEL_PATTERNS);
  const isRecordButton = hasAnyLabelPattern(ariaLabel, CLAUDE_RECORD_LABEL_PATTERNS);
  const isFeedbackButton = hasAnyLabelPattern(ariaLabel, EXCLUDED_BUTTON_LABEL_PATTERNS);

  return isAttachmentMenu || isModelSelector || (hasMenu && isModelSelector) || isRecordButton || isFeedbackButton;
}

function hasKnownSendLabel(button) {
  const ariaLabel = button.getAttribute("aria-label") || "";
  const normalizedAriaLabel = normalizeLabel(ariaLabel);

  return SEND_BUTTON_LABEL_PATTERNS.some((pattern) => ariaLabel.includes(pattern)) ||
    SEND_BUTTON_LABEL_LOWERCASE_PATTERNS.some((pattern) => normalizedAriaLabel.includes(pattern.toLowerCase()));
}

function hasStrongClaudeSendSignal(button) {
  if (!(button instanceof HTMLButtonElement)) return false;

  const ariaLabel = button.getAttribute("aria-label") || "";
  if (CLAUDE_STRONG_SEND_LABELS.includes(ariaLabel)) return true;

  return hasKnownSendLabel(button);
}

function scoreClaudeSendButton(button, textbox, root) {
  if (!(button instanceof HTMLButtonElement) || !(textbox instanceof HTMLElement) || !(root instanceof HTMLElement)) {
    return 0;
  }

  let score = 0;
  if (hasStrongClaudeSendSignal(button)) score += 100;
  if ((button.className || "").toString().includes("_claude_")) score += 20;

  const buttonRect = button.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const isSmallButton = buttonRect.width > 0 &&
    buttonRect.height > 0 &&
    buttonRect.width <= 80 &&
    buttonRect.height <= 80;
  const isRightSideButton = rootRect.width > 0 &&
    buttonRect.left >= rootRect.left + rootRect.width * 0.55;
  if (isSmallButton) score += 5;
  if (isRightSideButton) score += 10;

  return score;
}

function findClaudeComposerRoot(textbox) {
  if (!isClaudeTextbox(textbox)) return null;

  let node = textbox.parentElement;
  let depth = 0;
  while (node instanceof HTMLElement && depth < CLAUDE_COMPOSER_ROOT_MAX_DEPTH) {
    if (!isTooBroadClaudeRoot(node) && node.contains(textbox)) {
      const buttons = Array.from(node.querySelectorAll("button"));
      if (buttons.length > 0 && buttons.length <= CLAUDE_COMPOSER_ROOT_MAX_BUTTONS) {
        return node;
      }
    }

    node = node.parentElement;
    depth += 1;
  }

  return null;
}

function collectClaudeSendButtonCandidates(textbox) {
  const root = findClaudeComposerRoot(textbox);
  if (!(root instanceof HTMLElement)) {
    return { root: null, candidates: [], strongCandidates: [] };
  }

  const candidates = [];
  const strongCandidates = [];
  const buttons = Array.from(root.querySelectorAll("button"));
  for (const button of buttons) {
    if (!isSelectableClaudeButton(button)) continue;
    if (isExcludedClaudeButton(button)) continue;

    candidates.push(button);
    if (scoreClaudeSendButton(button, textbox, root) >= 100) {
      strongCandidates.push(button);
    }
  }

  return { root, candidates, strongCandidates };
}

function findSendButtonBySingleRemainingClaudeCandidate(root, candidates) {
  if (!(root instanceof HTMLElement)) return null;
  return candidates.length === 1 ? candidates[0] : null;
}

function resolveClaudeSendButton(inputTarget) {
  if (!isClaudeTextbox(inputTarget)) return null;

  const { root, candidates, strongCandidates } = collectClaudeSendButtonCandidates(inputTarget);
  if (!(root instanceof HTMLElement)) return null;

  if (strongCandidates.length === 1) {
    return strongCandidates[0];
  }

  return findSendButtonBySingleRemainingClaudeCandidate(root, candidates);
}

function resolveClaudeInputTarget(target) {
  if (!target || !(target instanceof Element)) return null;

  // Primary: Claude main input.
  const chatInput = target.closest('[data-testid="chat-input"]');
  if (isClaudeTextbox(chatInput)) return chatInput;

  // Fallback: contenteditable textbox shape used by Claude input variants.
  const textbox = target.closest('[contenteditable="true"][role="textbox"]');
  if (isClaudeTextbox(textbox)) return textbox;

  return null;
}

function shouldSendByMode(mode, isShift, isCtrl, isAlt, isMeta, isMac) {
  if (isAlt) return false;

  if (mode === "shift") {
    return isShift && !isCtrl && !isMeta;
  }
  if (mode === "ctrl") {
    return isCtrl && !isShift && !isMeta;
  }
  if (mode === "cmd") {
    return isMac && isMeta && !isShift && !isCtrl;
  }
  if (mode === "both") {
    if (isMac) {
      return [isShift, isCtrl, isMeta].filter(Boolean).length === 1;
    }
    return (isShift && !isCtrl && !isMeta) || (isCtrl && !isShift && !isMeta);
  }
  if (mode === "shiftCmd") {
    return isMac && isShift && isMeta && !isCtrl;
  }
  return isShift && isCtrl && !isMeta;
}

function handleKey(event) {
  const isEnter = event.code === "Enter" || event.code === "NumpadEnter";
  const inputTarget = resolveClaudeInputTarget(event.target);
  const inCompositionGraceWindow =
    lastCompositionEndAt > 0 &&
    performance.now() - lastCompositionEndAt < COMPOSITION_END_GRACE_MS;

  if (!event.isTrusted) return;
  if (isComposingActive || event.isComposing || event.keyCode === 229 || inCompositionGraceWindow) return;
  if (!settingsLoaded) return;
  if (!settings.enabled) return;
  if (!inputTarget || !isEnter) return;

  const mode = sanitizeModeForPlatform(settings.mode, isMacPlatform);
  const isOnlyEnter = !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
  const isSend = shouldSendByMode(
    mode,
    event.shiftKey,
    event.ctrlKey,
    event.altKey,
    event.metaKey,
    isMacPlatform
  );

  // Enter only -> newline
  if (isOnlyEnter) {
    blockEnterEvent(event);
    insertClaudeNewline(inputTarget);
    return;
  }

  // Configured shortcut -> send
  if (isSend) {
    blockEnterEvent(event);
    const sendButton = resolveClaudeSendButton(inputTarget);
    if (sendButton && !sendButton.disabled) {
      sendButton.click();
    }
    return;
  }

  // Block unapproved modified Enter to avoid Claude default shortcuts.
  if (event.ctrlKey || event.shiftKey || event.metaKey || event.altKey) {
    blockEnterEvent(event);
  }
}

document.addEventListener("keydown", handleKey, { capture: true });

document.addEventListener("compositionstart", (event) => {
  const inputTarget = resolveClaudeInputTarget(event.target);
  if (!inputTarget) return;
  isComposingActive = true;
}, { capture: true });

document.addEventListener("compositionend", (event) => {
  const inputTarget = resolveClaudeInputTarget(event.target);
  if (!inputTarget) return;
  isComposingActive = false;
  lastCompositionEndAt = performance.now();
}, { capture: true });
})();
