const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../content.js'), 'utf8');

// Small DOM doubles supply tree/visibility facts. All candidate selection and
// shortcut handling execute the actual production closure. Chromium covers layout.
function setup() {
  const handlers = {};
  class Element {
    constructor(tag = 'DIV', attrs = {}) {
      this.tagName = tag; this.attrs = attrs; this.children = [];
      this.parentElement = null; this.visible = true; this.disabled = false; this.readOnly = false;
      this.className = ''; this.clicks = 0;
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    append(child) { child.parentElement = this; this.children.push(child); return child; }
    contains(other) { return this === other || this.children.some(child => child.contains(other)); }
    matches(selector) {
      if (selector === 'button') return this.tagName === 'BUTTON';
      if (selector === '[data-testid="chat-input"]') return this.attrs['data-testid'] === 'chat-input';
      if (selector === '[contenteditable="true"][role="textbox"]')
        return this.attrs.contenteditable === 'true' && this.attrs.role === 'textbox';
      throw new Error('Unexpected selector: ' + selector);
    }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
      return null;
    }
    querySelectorAll(selector) {
      const selectors = selector.split(',').map(s => s.trim());
      const found = [];
      const visit = node => {
        for (const child of node.children) {
          if (selectors.some(s => child.matches(s))) found.push(child);
          visit(child);
        }
      };
      visit(this); return found;
    }
    getClientRects() {
      for (let node = this; node; node = node.parentElement) if (!node.visible) return [];
      return [{}];
    }
    getBoundingClientRect() { return { left: 0, width: 40, height: 30 }; }
    click() { this.clicks++; }
  }
  class HTMLElement extends Element {}
  class HTMLButtonElement extends HTMLElement {
    constructor(label) { super('BUTTON', label === null ? {} : { 'aria-label': label }); }
  }
  const body = new HTMLElement('BODY');
  const document = {
    activeElement: body,
    documentElement: { hasAttribute: () => false, setAttribute() {} },
    addEventListener: (name, fn) => { handlers[name] = fn; },
  };
  const context = vm.createContext({
    window: {}, document, Element, HTMLElement, HTMLButtonElement,
    performance: { now: () => 1000 },
    chrome: { storage: { local: { get() {}, set() {} }, onChanged: { addListener() {} } } },
  });
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, `
    settingsLoaded = true;
    globalThis.api = { resolveClaudeSendButton };
  })();`), context);
  const root = body.append(new HTMLElement('SECTION'));
  const input = (parent = root, attrs = { 'data-testid': 'chat-input', contenteditable: 'true', role: 'textbox' }) =>
    parent.append(new HTMLElement('DIV', attrs));
  const button = (label = 'Send message', parent = root) => parent.append(new HTMLButtonElement(label));
  const send = target => handlers.keydown({
    target, code: 'Enter', isTrusted: true, shiftKey: true,
    ctrlKey: false, metaKey: false, altKey: false,
    preventDefault() {}, stopImmediatePropagation() {},
  });
  return { root, body, document, input, button, send, HTMLElement, api: context.api };
}

test('two live inputs sharing one button: each focused shortcut is rejected', () => {
  const h = setup(); const first = h.input(); const second = h.input(); const button = h.button();
  for (const editor of [first, second]) {
    h.document.activeElement = editor;
    assert.equal(h.api.resolveClaudeSendButton(editor), null);
    h.send(editor);
    assert.equal(button.clicks, 0);
  }
});
test('unknown single button is never sufficient', () => {
  const h = setup(); const editor = h.input(); const button = h.button(null);
  h.document.activeElement = editor; h.send(editor);
  assert.equal(button.clicks, 0);
});
test('class and favorable geometry cannot promote an unknown button', () => {
  const h = setup(); const editor = h.input(); const button = h.button(null);
  button.className = '_claude_send'; button.getBoundingClientRect = () => ({ left: 35, width: 20, height: 20 });
  h.document.activeElement = editor; h.send(editor);
  assert.equal(button.clicks, 0);
});
for (const label of ['Send message', 'Invia messaggio', 'Envoyer', '送信', 'Senden', '보내기', '发送']) {
  test('known single send label: ' + label, () => {
    const h = setup(); const editor = h.input(); const button = h.button(label);
    h.document.activeElement = editor;
    assert.equal(h.api.resolveClaudeSendButton(editor), button);
    h.send(editor); assert.equal(button.clicks, 1);
  });
}
test('independent composer roots: active input resolves its own button', () => {
  const h = setup(); const first = h.input(); const firstButton = h.button();
  const secondRoot = h.body.append(new h.HTMLElement('SECTION'));
  const second = h.input(secondRoot); const secondButton = h.button('Send message', secondRoot);
  h.document.activeElement = second; h.send(second);
  assert.equal(firstButton.clicks, 0); assert.equal(secondButton.clicks, 1);
  assert.equal(h.api.resolveClaudeSendButton(first), null);
});
test('focused descendant and nested markers resolve to one logical input', () => {
  const h = setup(); const editor = h.input();
  const inner = h.input(editor, { contenteditable: 'true', role: 'textbox' });
  const child = inner.append(new h.HTMLElement('SPAN')); const button = h.button();
  h.document.activeElement = inner; h.send(child);
  assert.equal(button.clicks, 1);
});
for (const condition of ['hidden', 'disabled', 'readOnly', 'aria-disabled']) {
  test(condition + ' stale input does not create ambiguity for the active live input', () => {
    const h = setup(); const editor = h.input(); const stale = h.input(); const button = h.button();
    if (condition === 'hidden') stale.visible = false;
    else if (condition === 'aria-disabled') stale.attrs['aria-disabled'] = 'true';
    else stale[condition] = true;
    h.document.activeElement = editor; h.send(editor); assert.equal(button.clicks, 1);
    h.document.activeElement = stale; h.send(stale); assert.equal(button.clicks, 1);
  });
}
test('event target different from active editor is rejected', () => {
  const h = setup(); const editor = h.input(); const button = h.button();
  h.send(editor); assert.equal(button.clicks, 0);
});
test('two known send candidates are rejected', () => {
  const h = setup(); const editor = h.input(); const first = h.button(); const second = h.button();
  h.document.activeElement = editor; h.send(editor);
  assert.equal(first.clicks + second.clicks, 0);
});
test('one known send and one unknown button selects only the known action', () => {
  const h = setup(); const editor = h.input(); const known = h.button(); const unknown = h.button(null);
  h.document.activeElement = editor; h.send(editor);
  assert.equal(known.clicks, 1); assert.equal(unknown.clicks, 0);
});
test('disabled known button and unknown fallback cannot cause a click', () => {
  const h = setup(); const editor = h.input(); const known = h.button(); const unknown = h.button(null);
  known.disabled = true; h.document.activeElement = editor; h.send(editor);
  assert.equal(known.clicks + unknown.clicks, 0);
});
