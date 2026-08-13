/* global window, document */
(function bootstrapTheme() {
  var preference = 'SYSTEM';
  try {
    var stored = window.localStorage.getItem('rpg-manager-theme');
    if (stored === 'LIGHT' || stored === 'DARK' || stored === 'SYSTEM') preference = stored;
  } catch {
    preference = 'SYSTEM';
  }
  var systemIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var resolved = preference === 'DARK' || (preference === 'SYSTEM' && systemIsDark) ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  var themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', resolved === 'dark' ? '#160d0f' : '#f6efe3');
}());
