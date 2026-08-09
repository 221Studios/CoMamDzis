/** Wspólne anulowanie długiego logowania (WebView + ignorowanie spóźnionych wyników). */

import { cancelUsosWebViewLogin } from './usosWebViewBridge.js';
import { cancelWszipWebViewLogin } from './wszipWebViewBridge.js';

let loginAttempt = 0;

export const LOGIN_CANCELLED_CODE = 'LOGIN_CANCELLED';

export function beginLoginAttempt() {
  loginAttempt += 1;
  return loginAttempt;
}

export function isLoginAttemptCurrent(attemptId) {
  return attemptId === loginAttempt;
}

export function cancelActiveLoginOperations() {
  loginAttempt += 1;
  cancelUsosWebViewLogin?.();
  cancelWszipWebViewLogin?.();
}

export function isLoginCancelledError(error) {
  return error?.code === LOGIN_CANCELLED_CODE;
}

export function createLoginCancelledError(message = 'Przerwano logowanie.') {
  const error = new Error(message);
  error.code = LOGIN_CANCELLED_CODE;
  return error;
}
