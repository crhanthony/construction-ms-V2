// Applies the saved (or system) theme before the page paints, so there is no light/dark flash.
(() => {
  let t = null;
  try { t = localStorage.getItem('bt-theme'); } catch (e) { /* storage blocked */ }
  if (!t) t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
})();
