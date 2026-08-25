// Permission-test module (read-only app experiment). Intentional violations.
export function probe(name: string): string {
  // TODO: replace with real probe   (violation typescript:S1135)
  let result = 'unknown';
  try {
    result = name.trim();
  } catch (e) {
    // violation typescript:S2486 - exception ignored
  }
  return result;
}
