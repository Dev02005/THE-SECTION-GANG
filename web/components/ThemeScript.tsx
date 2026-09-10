/**
 * Applies the signed-in officer's stored theme before first paint.
 *
 * Runs inline in <head> so the page never flashes the wrong ground. Three
 * states are possible: an explicit "light"/"dark" choice stamps the root
 * element, and "system" stamps nothing so prefers-color-scheme decides.
 *
 * It checks for a session for the same reason `ThemeToggle` hides itself when
 * there is none: a stored choice belongs to a signed-in post. Without this
 * check the stored theme would paint, and the toggle would then clear it a
 * moment later - a visible flash, and the wrong answer in between.
 */
export function ThemeScript() {
  const script = `(function(){try{
    if (!localStorage.getItem('corridor.session')) return;
    var t = localStorage.getItem('corridor-theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    }
  }catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
