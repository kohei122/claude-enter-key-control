const { test, expect } = require('./helpers/extension.cjs');

async function clicks(page, expected) {
  expect(await page.evaluate(() => window.fixture.clicks)).toEqual(expected);
  expect(await page.evaluate(() => window.fixture.submitCount)).toBe(expected.length);
}
async function newline(page, editor) {
  await editor.fill('first');
  await editor.press('End');
  await editor.press('Enter');
  await page.keyboard.type('second');
  expect(await editor.innerText()).toBe('first\nsecond');
  expect(await editor.evaluate(e => [...e.childNodes].map(n => [n.nodeName, n.textContent])))
    .toEqual([['#text', 'first'], ['DIV', 'second']]);
  await clicks(page, []);
  expect(await page.evaluate(() => window.fixture.hostKeys)).toEqual([]);
}

for (const [mode, key] of [['shift', 'Shift+Enter'], ['ctrl', 'Control+Enter'],
  ['both', 'Shift+Enter'], ['both', 'Control+Enter'], ['combo', 'Control+Shift+Enter']]) {
  test(mode + ' ' + key + ': newline then exactly one send', async ({ harness }) => {
    const { page, open } = harness;
    await open('current', { mode });
    const editor = page.locator('#editor');
    await newline(page, editor);
    await editor.press(key);
    await clicks(page, ['send']);
    expect(await editor.innerText()).toBe('first\nsecond');
  expect(await editor.evaluate(e => [...e.childNodes].map(n => [n.nodeName, n.textContent])))
    .toEqual([['#text', 'first'], ['DIV', 'second']]);
  });
}
for (const fixture of ['fallback', 'stale-valid', 'exclusions']) {
  test(fixture + ': focused editor sends only its candidate', async ({ harness }) => {
    const { page, open } = harness;
    await open(fixture);
    const editor = page.locator('#editor');
    await newline(page, editor);
    await editor.press('Shift+Enter');
    await clicks(page, ['send']);
  });
}
for (const fixture of ['no-send', 'multiple-send', 'unknown-root']) {
  test(fixture + ': newline works, send fails closed', async ({ harness }) => {
    const { page, open } = harness;
    await open(fixture);
    const editor = page.locator('#editor');
    await newline(page, editor);
    await editor.press('Shift+Enter');
    await clicks(page, []);
  });
}
for (const condition of ['disabled', 'aria-disabled', 'hidden', 'feedback', 'record', 'model', 'attachment']) {
  test('send candidate ' + condition + ': no click', async ({ harness }) => {
    const { page, open } = harness;
    await open('current');
    await page.locator('#send').evaluate((button, condition) => {
      if (condition === 'disabled') button.disabled = true;
      if (condition === 'aria-disabled') button.setAttribute('aria-disabled', 'true');
      if (condition === 'hidden') button.hidden = true;
      if (condition === 'feedback') button.setAttribute('aria-label', 'Send feedback');
      if (condition === 'record') button.setAttribute('aria-label', 'Press and hold to record');
      if (condition === 'model') button.setAttribute('data-testid', 'model-selector-dropdown');
      if (condition === 'attachment') {
        button.setAttribute('aria-label', 'Add files'); button.setAttribute('aria-haspopup', 'menu');
      }
    }, condition);
    const editor = page.locator('#editor');
    await newline(page, editor);
    await editor.press('Shift+Enter');
    await clicks(page, []);
  });
}
for (const fixture of ['no-input', 'hidden-only']) {
  test(fixture + ': no focusable editor, no extension click', async ({ harness }) => {
    const { page, open } = harness;
    await open(fixture);
    if (fixture === 'hidden-only') {
      await page.locator('#editor').evaluate(editor => editor.focus());
      await expect(page.locator('#editor')).not.toBeFocused();
    }
    await page.keyboard.press('Enter');
    await page.keyboard.press('Shift+Enter');
    await clicks(page, []);
    expect(await page.evaluate(() => window.fixture.hostKeys.length)).toBe(2);
  });
}
for (const fixture of ['unknown-input', 'textarea']) {
  test(fixture + ': unrecognized input is left to the host', async ({ harness }) => {
    const { page, open } = harness;
    await open(fixture);
    const editor = page.locator('#editor');
    await editor.fill('draft');
    await editor.press('Enter');
    await editor.press('Shift+Enter');
    await clicks(page, []);
    expect(await page.evaluate(() => window.fixture.hostKeys)).toEqual([
      { trusted: true, prevented: false }, { trusted: true, prevented: false },
    ]);
  });
}
test('multiple independent composers: existing focus-local behavior (not global fail closed)', async ({ harness }) => {
  const { page, open } = harness;
  await open('multiple-composers');
  for (const id of ['editor', 'second']) {
    await page.locator('#' + id).fill('draft');
    await page.locator('#' + id).press('Shift+Enter');
  }
  await clicks(page, ['send', 'second-send']);
});
test('shared root with two inputs: focus alone cannot disambiguate the send context', async ({ harness }) => {
  const { page, open } = harness;
  await open('shared-inputs');
  for (const id of ['editor', 'second']) {
    await page.locator('#' + id).fill('draft');
    await page.locator('#' + id).press('Shift+Enter');
  }
  await clicks(page, []);
});
test('unknown single button: no known send signal, no click', async ({ harness }) => {
  const { page, open } = harness;
  await open('single-unknown');
  await page.locator('#editor').fill('draft');
  await page.locator('#editor').press('Shift+Enter');
  await clicks(page, []);
});
test('one strong send wins over an additional weak candidate', async ({ harness }) => {
  const { page, open } = harness;
  await open('current');
  await page.locator('.composer').evaluate(root => {
    const other = document.createElement('button'); other.id = 'other'; other.textContent = '?'; root.append(other);
  });
  await page.locator('#editor').fill('draft');
  await page.locator('#editor').press('Shift+Enter');
  await clicks(page, ['send']);
});
for (const boundary of ['too-many-buttons', 'too-deep']) {
  test(boundary + ': bounded root search fails closed', async ({ harness }) => {
    const { page, open } = harness;
    await open('current');
    await page.locator('.composer').evaluate((root, boundary) => {
      if (boundary === 'too-many-buttons') {
        for (let i = 0; i < 8; i++) root.append(document.createElement('button'));
      } else {
        const editor = root.querySelector('#editor');
        for (let i = 0; i < 10; i++) {
          const wrapper = document.createElement('div'); editor.replaceWith(wrapper); wrapper.append(editor);
        }
      }
    }, boundary);
    await page.locator('#editor').fill('draft');
    await page.locator('#editor').press('Shift+Enter');
    await clicks(page, []);
  });
}
test('unapproved modified Enter combinations are blocked', async ({ harness }) => {
  const { page, open } = harness;
  await open('current');
  const editor = page.locator('#editor');
  await editor.fill('draft');
  for (const key of ['Control+Enter', 'Control+Shift+Enter', 'Alt+Enter']) await editor.press(key);
  await clicks(page, []);
  expect(await editor.innerText()).toBe('draft');
  expect(await page.evaluate(() => window.fixture.hostKeys)).toEqual([]);
});
test('composition state abstains on trusted keys (not native OS IME)', async ({ harness }) => {
  const { page, open } = harness;
  await open('current');
  const editor = page.locator('#editor');
  await editor.fill('draft');
  await editor.dispatchEvent('compositionstart', { data: '' });
  await editor.press('Enter');
  await editor.press('Shift+Enter');
  await clicks(page, []);
  expect(await page.evaluate(() => window.fixture.hostKeys)).toEqual([
    { trusted: true, prevented: false }, { trusted: true, prevented: false },
  ]);
  await editor.dispatchEvent('compositionend', { data: '' });
});
test('disabled extension negative control: keys reach host and no newline is inserted', async ({ harness }) => {
  const { page, open } = harness;
  await open('current', { enabled: false });
  const editor = page.locator('#editor');
  await editor.fill('draft');
  await editor.press('Enter');
  await editor.press('Shift+Enter');
  expect(await editor.innerText()).toBe('draft');
  await clicks(page, []);
  expect(await page.evaluate(() => window.fixture.hostKeys.length)).toBe(2);
});
test('untrusted synthetic shortcut is ignored', async ({ harness }) => {
  const { page, open } = harness;
  await open('current');
  await page.locator('#editor').dispatchEvent('keydown', {
    key: 'Enter', code: 'Enter', shiftKey: true, bubbles: true, cancelable: true,
  });
  await clicks(page, []);
  expect(await page.evaluate(() => window.fixture.hostKeys)).toEqual([{ trusted: false, prevented: false }]);
});

test('shared root with hidden stale input: unique live active editor still sends', async ({ harness }) => {
  const { page, open } = harness;
  await open('shared-inputs');
  await page.locator('#second').evaluate(editor => { editor.hidden = true; });
  await newline(page, page.locator('#editor'));
  await page.locator('#editor').press('Shift+Enter');
  await clicks(page, ['send']);
});
test('nested textbox marker and focused descendant represent one logical input', async ({ harness }) => {
  const { page, open } = harness;
  await open('current');
  await page.locator('#editor').evaluate(editor => {
    const inner = document.createElement('div');
    inner.id = 'inner'; inner.contentEditable = 'true'; inner.tabIndex = 0;
    inner.setAttribute('role', 'textbox');
    editor.append(inner);
  });
  await page.locator('#inner').fill('draft');
  await page.locator('#inner').focus();
  await expect(page.locator('#inner')).toBeFocused();
  await page.locator('#inner').press('Shift+Enter');
  await clicks(page, ['send']);
});
test('unknown single button with class and geometry hints remains rejected', async ({ harness }) => {
  const { page, open } = harness;
  await open('single-unknown');
  await page.locator('#unknown').evaluate(button => {
    button.className = '_claude_send'; button.style.marginLeft = '400px';
    button.style.width = '40px'; button.style.height = '40px';
  });
  await page.locator('#editor').fill('draft');
  await page.locator('#editor').press('Shift+Enter');
  await clicks(page, []);
});
for (const label of ['Envoyer', '送信', 'Senden', '보내기', '发送']) {
  test('existing localized send label: ' + label, async ({ harness }) => {
    const { page, open } = harness;
    await open('current');
    await page.locator('#send').evaluate((button, label) => button.setAttribute('aria-label', label), label);
    await page.locator('#editor').fill('draft');
    await page.locator('#editor').press('Shift+Enter');
    await clicks(page, ['send']);
  });
}
