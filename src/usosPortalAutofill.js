import {
  buildAutofillScript,
  buildPortalHandshakeScript,
  getCollegeLoginStartUrl,
  isAdfsLoginUrl,
  isCasLoginPageUrl,
  isKeycloakLoginUrl,
  isMicrosoftEntraLoginUrl,
  isUjAdfsUrl,
  isUmcsLoginHost,
  isUsosPortalHostUrl,
  usosWebViewUserAgent
} from './usosWebViewLogin.js';

export { usosWebViewUserAgent };

export function shouldInjectUsosPortalAutofill(url, portalUrl) {
  const value = String(url || '');
  if (
    isCasLoginPageUrl(value)
    || isUmcsLoginHost(value)
    || isUjAdfsUrl(value)
    || isAdfsLoginUrl(value)
    || isMicrosoftEntraLoginUrl(value)
    || isKeycloakLoginUrl(value)
  ) return true;
  if (portalUrl && isUsosPortalHostUrl(value, portalUrl)) {
    return /logowaniecas|logowanie/i.test(value) || /_action=home\/index/i.test(value);
  }
  return false;
}

export function buildUsosPortalAutofillScript(login, password, url, portalUrl) {
  const value = String(url || '');
  if (portalUrl && isUsosPortalHostUrl(value, portalUrl) && !isCasLoginPageUrl(value) && !isUjAdfsUrl(value)) {
    return buildPortalHandshakeScript(portalUrl);
  }
  return buildAutofillScript(login, password, value);
}

export function resolveUsosPortalWebView({ email, password, portalUrl }) {
  const login = String(email || '').trim();
  const pass = String(password || '');
  const portal = String(portalUrl || '').trim();
  if (!login || !pass || !portal) {
    return { autoLogin: null, url: portal || 'about:blank' };
  }
  return {
    autoLogin: { login, password: pass, portalUrl: portal },
    url: getCollegeLoginStartUrl(portal)
  };
}
