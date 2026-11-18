import { useCallback, useSyncExternalStore } from 'react';
import { createWorkspaceStore } from './workspace-store.js';

export const workspaceHost = window.parent !== window && window.parent.location.origin === window.location.origin ? window.parent : window;
export function workspaceAccount() {
  try {
    const session = JSON.parse(workspaceHost.localStorage.getItem('onecode.settings.dat:platformAuthSession') || 'null');
    return session?.token === workspaceHost.localStorage.getItem('onecode.settings.dat:platformAuthToken') ? session?.account?.id : undefined;
  } catch { return undefined; }
}
const account = workspaceAccount();
const bankKey = '__onescienceSubmissionWorkspaceV1';
const bank = workspaceHost[bankKey] ||= new Map();
const clearOtherAccounts = (all = false) => {
  for (const [key, store] of bank) {
    if (all || key !== workspaceAccount()) { store.dispose(); bank.delete(key); }
  }
};

clearOtherAccounts();
if (!bank.has(account)) bank.set(account, createWorkspaceStore(workspaceHost.sessionStorage, `onescience.submission.v1:${account}`, () => !!account && workspaceAccount() === account));
const store = bank.get(account);
export const resetUploadDraft = () => store.resetUpload();

export function useWorkspaceState(key, initial) {
  const subscribe = useCallback((listener) => {
    const unsubscribe = store.subscribe(listener);
    // React does not necessarily unmount before an iframe is removed.
    window.addEventListener('pagehide', unsubscribe, { once: true });
    return () => { unsubscribe(); window.removeEventListener('pagehide', unsubscribe); };
  }, []);
  const value = useSyncExternalStore(subscribe, () => store.get(key, initial));
  const setValue = useCallback((next) => store.set(key, next, initial), [key]);
  return [value, setValue];
}
