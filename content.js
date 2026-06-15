(() => {
const INIT_KEY = "__claudeEnterKeyControlInitialized";
if (window[INIT_KEY]) return;
window[INIT_KEY] = true;

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

let settings = { ...DEFAULT_SETTINGS };
let settingsLoaded = false;
let isMacPlatform = false;

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

async function loadSettings() {
  isMacPlatform = await getIsMacPlatform();

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

function findSendButton(scope) {
  if (!(scope instanceof Element)) return null;

  return scope.querySelector(
    'button[aria-label="メッセージを送信"], button[aria-label*="Send" i]'
  );
}

function resolveClaudeSendButton(inputTarget) {
  if (!(inputTarget instanceof HTMLElement)) return null;

  let node = inputTarget.parentElement;
  while (node instanceof HTMLElement) {
    const button = findSendButton(node);
    if (button instanceof HTMLButtonElement) return button;
    node = node.parentElement;
  }

  const globalButton = findSendButton(document);
  return globalButton instanceof HTMLButtonElement ? globalButton : null;
}

function resolveClaudeInputTarget(target) {
  if (!target || !(target instanceof Element)) return null;

  // Primary: Claude main input.
  const chatInput = target.closest('[data-testid="chat-input"]');
  if (chatInput instanceof HTMLElement) return chatInput;

  // Fallback: contenteditable textbox shape used by Claude input variants.
  const textbox = target.closest('[contenteditable="true"][role="textbox"]');
  if (textbox instanceof HTMLElement) return textbox;

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

  if (!event.isTrusted) return;
  if (event.isComposing) return;
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
})();
