/**
 * How many lines react-native-web lets a Text show, read from what it rendered (`getComputedStyle`), not from the prop.
 * It renders `numberOfLines={2}` as `-webkit-line-clamp: 2`, and `numberOfLines={1}` as no clamp at all but one
 * unwrapped line that ends in an ellipsis. Anything else is unbounded. The UI tests' one copy (StreamScreen.layout,
 * MatchLabel, StageLine).
 */
export function linesAllowed(element: Element): number {
  const style = getComputedStyle(element);
  const clamp = style.getPropertyValue('-webkit-line-clamp');
  if (clamp !== '') return Number(clamp);
  if (style.whiteSpace === 'nowrap' && style.textOverflow === 'ellipsis') return 1;
  return Infinity;
}
