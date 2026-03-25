const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "shift"
};

function sanitizeEnabled(enabled) {
  if (enabled === true || enabled === false) return enabled;
  if (enabled === "true") return true;
  if (enabled === "false") return false;
  return true;
}

function sanitizeMode(mode) {
  return mode === "ctrl" || mode === "both" || mode === "combo" ? mode : "shift";
}

const toggle = document.getElementById("toggle");
const radios = document.querySelectorAll('input[name="mode"]');
const appVersion = document.getElementById("app-version");

if (appVersion) {
  appVersion.textContent = `v${chrome.runtime.getManifest().version}`;
}

chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
  const settings = {
    enabled: sanitizeEnabled(stored.enabled),
    mode: sanitizeMode(stored.mode)
  };

  toggle.checked = settings.enabled;

  const selected = document.querySelector(`input[name="mode"][value="${settings.mode}"]`);
  if (selected) selected.checked = true;

  chrome.storage.local.set(settings);
});

toggle.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: sanitizeEnabled(toggle.checked) });
});

radios.forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    chrome.storage.local.set({ mode: sanitizeMode(radio.value) });
  });
});

