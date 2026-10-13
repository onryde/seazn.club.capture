/**
 * The value a rendered element's own styles declare for a CSS property, or '' when none does: its inline style, else
 * the last of the single-class rules react-native-web inserted that the element carries (a `StyleSheet.create` style
 * renders as one atomic class per property). Unlike `getComputedStyle`, it never answers CSS's initial value, which can
 * hide a missing style: a Text's computed `flex-shrink` is 1 with no style at all (CSS's initial, where Yoga's is 0),
 * since react-native-web's text class declares none, while its view class declares 0 (N31's title, Tile.test.tsx).
 */
export function declaredStyle(element: HTMLElement, property: string): string {
  const inline = element.style.getPropertyValue(property);
  if (inline !== '') return inline;
  let value = '';
  for (const sheet of [...document.styleSheets]) {
    for (const rule of [...sheet.cssRules]) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const only = /^\.([\w-]+)$/.exec(rule.selectorText)?.[1];
      if (only === undefined || !element.classList.contains(only)) continue;
      const declared = rule.style.getPropertyValue(property);
      if (declared !== '') value = declared;
    }
  }
  return value;
}
