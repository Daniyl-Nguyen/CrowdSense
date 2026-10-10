// Anonymous, device-local IDs. No accounts, no personal data.
function stored(key: string): string {
  try {
    let v = localStorage.getItem(key);
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(key, v);
    }
    return v;
  } catch {
    return crypto.randomUUID();
  }
}
export const presenterId = () => stored('rtr.presenterId');
export const clientId = () => stored('rtr.clientId');

export function pref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`rtr.${key}`);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function setPref(key: string, v: unknown) {
  try {
    localStorage.setItem(`rtr.${key}`, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
