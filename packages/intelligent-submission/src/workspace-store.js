// The store belongs to the platform window, so replacing the iframe does not
// discard selected files or the result of an in-flight request.
export function createWorkspaceStore(storage, storageKey, isCurrent = () => true) {
  const listeners = new Set();
  const transient = new Set(['upload.file', 'busy', 'error', 'projects', 'modelStatus']);
  let state = {};
  let active = true;
  try { const saved = JSON.parse(storage?.getItem(storageKey) || '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) state = saved; } catch { /* Start with an empty draft. */ }
  const publish = () => {
    try { storage?.setItem(storageKey, JSON.stringify(Object.fromEntries(Object.entries(state).filter(([key]) => !transient.has(key) && !key.endsWith('.file'))))); } catch { /* Memory still preserves the workspace when storage is full. */ }
    listeners.forEach((listener) => listener());
  };
  return {
    get(key, initial) {
      if (!Object.hasOwn(state, key)) state = { ...state, [key]: initial };
      return state[key];
    },
    set(key, value, initial) {
      if (!active || !isCurrent()) return;
      const previous = Object.hasOwn(state, key) ? state[key] : initial;
      state = { ...state, [key]: typeof value === 'function' ? value(previous) : value };
      publish();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    resetUpload() {
      state = Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('upload.')));
      publish();
    },
    dispose() {
      active = false;
      state = {};
      try { storage?.removeItem(storageKey); } catch { /* Storage may be disabled. */ }
      listeners.forEach((listener) => listener());
      listeners.clear();
    },
  };
}
