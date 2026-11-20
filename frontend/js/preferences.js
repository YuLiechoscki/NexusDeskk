(() => {
  try {
    const theme = localStorage.getItem('nexus.theme');
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
    if (localStorage.getItem('nexus.sidebar') === 'collapsed') document.documentElement.dataset.sidebar = 'collapsed';
  } catch { /* Storage can be disabled in private contexts. */ }
})();
