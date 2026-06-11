(function initAppearance(global) {
  const THEMES = ['dark', 'light', 'paper', 'field'];
  const FONT_SIZES = ['small', 'medium', 'large'];
  const LEGACY_THEMES = { woven: 'paper', forest: 'field' };

  function normalizeTheme(theme) {
    const migrated = LEGACY_THEMES[theme] || theme;
    return THEMES.includes(migrated) ? migrated : 'dark';
  }

  function normalizeFontSize(size) {
    return FONT_SIZES.includes(size) ? size : 'medium';
  }

  function removeClasses(element, classes) {
    classes.forEach(name => element.classList.remove(name));
  }

  function prefixedClasses(values, prefix, omitValue) {
    return values
      .filter(value => value !== omitValue)
      .map(value => `${prefix}${value}`);
  }

  function applyThemeClass(element, theme, options = {}) {
    if (!element) return 'dark';
    const normalized = normalizeTheme(theme);
    const prefix = options.prefix || '';
    removeClasses(element, prefixedClasses(THEMES, prefix, 'dark'));
    if (normalized !== 'dark') element.classList.add(`${prefix}${normalized}`);
    return normalized;
  }

  function applyFontSizeClass(element, size, options = {}) {
    if (!element) return 'medium';
    const normalized = normalizeFontSize(size);
    const prefix = options.prefix || 'font-';
    removeClasses(element, prefixedClasses(FONT_SIZES, prefix, 'medium'));
    if (normalized !== 'medium') element.classList.add(`${prefix}${normalized}`);
    return normalized;
  }

  function applyAppearanceClasses(element, settings, options = {}) {
    const hasTheme = Object.prototype.hasOwnProperty.call(settings || {}, 'theme');
    const hasFontSize = Object.prototype.hasOwnProperty.call(settings || {}, 'fontSize');
    return {
      theme: hasTheme
        ? applyThemeClass(element, settings.theme, { prefix: options.themePrefix || '' })
        : undefined,
      fontSize: hasFontSize
        ? applyFontSizeClass(element, settings.fontSize, { prefix: options.fontPrefix || 'font-' })
        : undefined,
    };
  }

  global.FDT_APPEARANCE = {
    THEMES,
    FONT_SIZES,
    LEGACY_THEMES,
    normalizeTheme,
    normalizeFontSize,
    applyThemeClass,
    applyFontSizeClass,
    applyAppearanceClasses,
  };
})(globalThis);
