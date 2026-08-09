/** Rejestr implementacji logowania USOS przez ukryte WebView (React Native). */

let loginImpl = null;
let mfaWaitingImpl = null;
let cancelImpl = null;

export function registerUsosWebViewLogin(fn) {
  loginImpl = typeof fn === 'function' ? fn : null;
}

export function registerUsosWebViewLoginCancel(fn) {
  cancelImpl = typeof fn === 'function' ? fn : null;
}

export function registerUsosWebViewMfaWaiting(fn) {
  mfaWaitingImpl = typeof fn === 'function' ? fn : null;
}

export function isUsosWebViewLoginAvailable() {
  return Boolean(loginImpl);
}

export function isUsosWebViewMfaWaiting() {
  return Boolean(mfaWaitingImpl?.());
}

export function runUsosWebViewLogin(options) {
  if (!loginImpl) {
    return Promise.reject(new Error('Logowanie USOS przez WebView nie jest dostępne w tym środowisku.'));
  }
  return loginImpl(options);
}

export function runUsosWebViewProfileRefresh(options) {
  if (!loginImpl) return Promise.resolve();
  return loginImpl({ ...options, profileOnly: true });
}

export function cancelUsosWebViewLogin() {
  cancelImpl?.();
}
