/** Rejestr implementacji logowania Moodle WSZiP przez WebView (React Native). */

let loginImpl = null;
let cancelImpl = null;

export function registerWszipWebViewLogin(fn) {
  loginImpl = typeof fn === 'function' ? fn : null;
}

export function registerWszipWebViewLoginCancel(fn) {
  cancelImpl = typeof fn === 'function' ? fn : null;
}

export function isWszipWebViewLoginAvailable() {
  return Boolean(loginImpl);
}

export function runWszipWebViewLogin(options) {
  if (!loginImpl) {
    return Promise.reject(new Error('Logowanie Moodle WSZiP przez WebView nie jest dostępne w tym środowisku.'));
  }
  return loginImpl(options);
}

export function cancelWszipWebViewLogin() {
  cancelImpl?.();
}
