const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../content.js'), 'utf8');

// VM-only access to the actual closure. Shipping content.js is never edited.
// DOM layout/candidate resolution is exercised in Chromium, not emulated here.
function load({ mode = 'shift', enabled = true, mac = false, ready = true } = {}) {
  const handlers = {};
  const effects = { paragraphs: 0, focused: 0 };
  let clock = 1000;
  class Element {}
  class HTMLElement extends Element {
    closest(selector) { return selector === '[data-testid="chat-input"]' ? this : null; }
    getAttribute(name) { return name === 'data-testid' ? 'chat-input' : null; }
    focus() { effects.focused++; }
  }
  const editor = new HTMLElement();
  const context = vm.createContext({
    window: {}, Element, HTMLElement,
    document: {
      documentElement: { hasAttribute: () => false, setAttribute() {} },
      addEventListener: (type, callback) => { handlers[type] = callback; },
      execCommand: command => { assert.equal(command, 'insertParagraph'); effects.paragraphs++; },
    },
    performance: { now: () => clock },
    // Deliberately leave async loading pending to test explicit readiness gates.
    chrome: { storage: { local: { get() {}, set() {} }, onChanged: { addListener() {} } } },
  });
  assert.ok(source.trimEnd().endsWith('})();'));
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, `
    globalThis.api = { sanitizeEnabled, sanitizeModeForPlatform, shouldSendByMode,
      setState(value) { settings = value; settingsLoaded = value.ready; isMacPlatform = value.mac; } };
  })();`), context);
  context.api.setState({ mode, enabled, mac, ready });
  function key(overrides = {}) {
    const event = { target: editor, key: 'Enter', code: 'Enter', isTrusted: true,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, keyCode: 13,
      prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; },
      ...overrides };
    handlers.keydown(event);
    return event;
  }
  return { api: context.api, handlers, editor, effects, key, setClock: value => { clock = value; } };
}
test('enabled normalization preserves booleans and string booleans', () => {
  const { api } = load();
  for (const [value, expected] of [[true, true], [false, false], ['true', true], ['false', false],
    [undefined, true], [null, true], [0, true]]) assert.equal(api.sanitizeEnabled(value), expected);
});
test('platform normalization restricts Mac-only modes and unknown settings', () => {
  const { api } = load();
  for (const mode of ['shift', 'ctrl', 'both', 'combo']) assert.equal(api.sanitizeModeForPlatform(mode, false), mode);
  for (const mode of ['cmd', 'shiftCmd']) {
    assert.equal(api.sanitizeModeForPlatform(mode, false), 'shift');
    assert.equal(api.sanitizeModeForPlatform(mode, true), mode);
  }
  assert.equal(api.sanitizeModeForPlatform('unknown', true), 'shift');
});
for (const mac of [false, true]) {
  const accepted = {
    shift: [1], ctrl: [2], cmd: mac ? [8] : [],
    both: mac ? [1, 2, 8] : [1, 2], combo: [3], shiftCmd: mac ? [9] : [],
  };
  for (const [mode, masks] of Object.entries(accepted)) {
    test((mac ? 'Mac' : 'Windows') + ' ' + mode + ': all 16 modifier combinations', () => {
      const { api } = load();
      for (let mask = 0; mask < 16; mask++) {
        assert.equal(api.shouldSendByMode(mode, !!(mask & 1), !!(mask & 2),
          !!(mask & 4), !!(mask & 8), mac), masks.includes(mask), 'modifier mask ' + mask);
      }
    });
  }
}
for (const code of ['Enter', 'NumpadEnter']) {
  test(code + ': production handler inserts a paragraph and suppresses host handling', () => {
    const h = load();
    const event = h.key({ code });
    assert.equal(h.effects.paragraphs, 1);
    assert.equal(h.effects.focused, 1);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
  });
}
for (const [name, state, event] of [
  ['disabled', { enabled: false }, {}], ['not ready', { ready: false }, {}],
  ['isComposing', {}, { isComposing: true }], ['keyCode 229', {}, { keyCode: 229 }],
  ['untrusted', {}, { isTrusted: false }], ['non Enter', {}, { code: 'KeyA' }],
  ['unknown target', {}, { target: null }],
]) {
  test(name + ': handler abstains', () => {
    const h = load(state); const key = h.key(event);
    assert.equal(key.prevented, false); assert.equal(key.stopped, false); assert.equal(h.effects.paragraphs, 0);
  });
}
test('compositionstart prevents intervention until compositionend', () => {
  const h = load();
  h.handlers.compositionstart({ target: h.editor });
  assert.equal(h.key().prevented, false);
  h.setClock(5000);
  assert.equal(h.key().prevented, false);
  h.handlers.compositionend({ target: h.editor });
  h.setClock(5080);
  assert.equal(h.key().prevented, true);
  assert.equal(h.effects.paragraphs, 1);
});
for (const elapsed of [0, 79, 80, 81]) {
  test('compositionend grace boundary +' + elapsed + 'ms', () => {
    const h = load(); h.handlers.compositionend({ target: h.editor }); h.setClock(1000 + elapsed);
    assert.equal(h.key().prevented, elapsed >= 80);
    assert.equal(h.effects.paragraphs, elapsed >= 80 ? 1 : 0);
  });
}
test('unrelated composition event does not disable editor handling', () => {
  const h = load(); h.handlers.compositionstart({ target: null });
  assert.equal(h.key().prevented, true);
});
test('unapproved modified Enter is suppressed without newline', () => {
  const h = load(); const event = h.key({ ctrlKey: true });
  assert.equal(event.prevented, true); assert.equal(event.stopped, true); assert.equal(h.effects.paragraphs, 0);
});
