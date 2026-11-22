// Styleguide behaviour: the EN/VI switch (?lang=vi also works) and, when the page is served by the studio,
// the project's own colours (the same --theme-* variables the shell writes). Opened as a bare file it keeps the neutral fallbacks.
const root = document.documentElement;
function setLang(lang) {
  root.lang = lang;
  for (const b of document.querySelectorAll('#lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
}
document.getElementById('lang').addEventListener('click', e => { const b = e.target.closest('button[data-lang]'); if (b) setLang(b.dataset.lang); });
setLang(new URLSearchParams(location.search).get('lang') === 'vi' ? 'vi' : 'en');
try {
  const res = await fetch('/api/studio/project');
  const project = res.ok ? await res.json() : null;
  for (const [role, hex] of Object.entries(project?.theme ?? {})) if (hex) root.style.setProperty('--theme-' + role, hex);
} catch { /* no studio server: neutral fallbacks */ }
