export function loadPrefs<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch (_) {
    return fallback
  }
}

export function savePrefs<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}

export default { loadPrefs, savePrefs }
