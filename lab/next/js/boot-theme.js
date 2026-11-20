// Light or dark before the first paint: the reader's choice if one was kept, else the system's.
// Storage may throw (an opaque origin): then the system decides and the toggle lasts the visit.
(function () {
  var pick = null;
  try { pick = window.localStorage.getItem('nx:theme'); } catch (e) { pick = null; }
  var dark = pick === 'dark' || (pick !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-pick', pick === 'dark' || pick === 'light' ? pick : 'auto');
})();
