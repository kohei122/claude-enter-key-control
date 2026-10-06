// Host observations only: no shortcut mapping, candidate selection or synthetic send.
window.fixture = { submitCount: 0, clicks: [], hostKeys: [] };
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  event.preventDefault();
  window.fixture.submitCount++;
  window.fixture.clicks.push(button.id);
}, true);
document.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  window.fixture.hostKeys.push({ trusted: event.isTrusted, prevented: event.defaultPrevented });
  // Neutralize host default behavior; newline must come from the actual extension.
  event.preventDefault();
});
document.documentElement.setAttribute('data-fixture-ready', 'true');
