/** Returns the first Unicode letter in a display name for a text-only avatar. */
export function avatarInitial(name: string, fallback = '?'): string {
  const initial = name.trim().match(/\p{L}/u)?.[0];
  return initial ? initial.toLocaleUpperCase() : fallback;
}
