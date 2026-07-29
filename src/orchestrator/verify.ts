// Verify decoration restored. Intentional violations.
export function verify(x: string): string {
  // TODO: real check (S1135)
  let r = 'na';
  try { r = x.trim(); } catch (e) { /* ignored (S2486) */ }
  return r;
}
