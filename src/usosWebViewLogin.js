/** Pomocnicze funkcje dla logowania USOS w ukrytym WebView. */

import { Platform } from 'react-native';
import { buildWebViewIcalExtractSource } from './usosIcalExtract.js';

export const USOS_WEBVIEW_LOGIN_TIMEOUT_MS = 120000;

export function getCollegeLoginStartUrl(portalUrl) {
  const service = encodeURIComponent(
    `${portalUrl.replace(/\/$/, '')}/kontroler.php?_action=logowaniecas/index`
  );
  const host = (() => {
    try {
      return new URL(portalUrl).hostname;
    } catch {
      return '';
    }
  })();

  if (/usos\.pw\.edu\.pl/i.test(host)) {
    return `https://cas.usos.pw.edu.pl/cas/login?locale=pl&service=${service}`;
  }
  if (/usosweb\.uj\.edu\.pl|uj\.edu\.pl/i.test(host)) {
    return `https://cas.uj.edu.pl/cas/login?service=${service}&locale=pl`;
  }
  if (/usosweb\.umcs\.pl|umcs\.pl/i.test(host)) {
    return `https://login.umcs.pl/login?service=${service}&locale=pl`;
  }
  if (/usosweb\.amu\.edu\.pl|amu\.edu\.pl/i.test(host)) {
    return `https://cas.amu.edu.pl/cas/login?service=${service}&locale=pl`;
  }

  if (/^usosweb\./i.test(host)) {
    const suffix = host.slice('usosweb.'.length);
    if (suffix) {
      return `https://cas.${suffix}/cas/login?service=${service}&locale=pl`;
    }
  }

  return `${portalUrl.replace(/\/$/, '')}/kontroler.php?_action=logowaniecas/index`;
}

export function portalHostFromUrl(portalUrl) {
  try {
    return new URL(portalUrl).hostname;
  } catch {
    return '';
  }
}

export function isUsosPortalHostUrl(url, portalUrl) {
  try {
    const portalHost = portalHostFromUrl(portalUrl);
    const current = new URL(url);
    return Boolean(portalHost && current.hostname === portalHost);
  } catch {
    return false;
  }
}

export function isUsosPortalLoggedInUrl(url, portalUrl) {
  try {
    const portalHost = portalHostFromUrl(portalUrl);
    const current = new URL(url);
    if (!portalHost || current.hostname !== portalHost) return false;
    if (/_action=logowaniecas\/index/i.test(url)) return false;
    return /_action=home\/|_action=news\/|_action=katalog2\/|_action=tt\/|wyloguj|logowaniecas\/logout/i.test(url);
  } catch {
    return false;
  }
}

export function isUsosPortalTicketCallbackUrl(url) {
  return /_action=logowaniecas\/index/i.test(String(url || '')) && /[?&]ticket=/i.test(String(url || ''));
}

export function normalizeUmcsLogin(login) {
  const value = String(login || '').trim();
  if (/^ical(\d+@umcs\.pl)$/i.test(value)) {
    return value.replace(/^ical/i, '');
  }
  return value;
}

export function isUmcsLoginHost(url) {
  return /login\.umcs\.pl/i.test(String(url || ''));
}

export function isUsosSecondFactorUrl(url) {
  const value = String(url || '');
  return (
    /sts\.uj\.edu\.pl/i.test(value)
    || /Multi-Factor|Uwierzytelnianie wieloskładnikowe|AzureMfaAuthentication/i.test(value)
    || /verificationOption|authMethod/i.test(value)
    || /Multifactor Provider Selection|CAS Multifactor Authentication Login/i.test(value)
  );
}

export function isUjAdfsUrl(url) {
  return /sts\.uj\.edu\.pl/i.test(String(url || ''));
}

export function isAdfsLoginUrl(url) {
  return /\/adfs\/|sts\./i.test(String(url || ''));
}

export function isMicrosoftEntraLoginUrl(url) {
  return /login\.microsoftonline\.com/i.test(String(url || ''));
}

export function isKeycloakLoginUrl(url) {
  return /\/realms\/[^/]+\/(?:protocol\/cas\/login|login-actions\/authenticate)/i.test(String(url || ''));
}

export function isSupportedUsosLoginPageUrl(url) {
  const value = String(url || '');
  return (
    isCasLoginPageUrl(value)
    || isUmcsLoginHost(value)
    || isUjAdfsUrl(value)
    || isAdfsLoginUrl(value)
    || isMicrosoftEntraLoginUrl(value)
    || isKeycloakLoginUrl(value)
  );
}

export function isUjPortal(portalUrl) {
  try {
    return /uj\.edu\.pl/i.test(new URL(portalUrl).hostname);
  } catch {
    return /uj\.edu\.pl/i.test(String(portalUrl || ''));
  }
}

function ujAdfsMfaScriptCore(codeJson) {
  return `
    function post(payload) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      } catch (e) {}
    }
    function isCodeField(el) {
      return el && /^(INPUT|TEXTAREA)$/i.test(el.tagName);
    }
    function isVisible(el) {
      if (!isCodeField(el) || el.type === 'hidden' || el.disabled) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }
    function findVisibleCodeInput() {
      const nodes = document.querySelectorAll(
        '#verificationCodeInput, #VerificationCodeInput, #proofConfirmation, #ProofConfirmation, #token, #otc, #otp, #otpCode, #code, #Code, #securityCode, input[name="VerificationCode"], input[name="verificationCode"], input[name="verification_code"], input[name="ProofConfirmation"], input[name="proofConfirmation"], input[name="token"], input[name="otc"], input[name="otp"], input[name="otpCode"], input[name="code"], input[name="Code"], input[name="Otp"], input[name="securityCode"], input[autocomplete="one-time-code"], input[type="tel"], input[inputmode="numeric"]'
      );
      for (let i = 0; i < nodes.length; i++) {
        if (isVisible(nodes[i])) return nodes[i];
      }
      return null;
    }
    function findVisibleCodeInputs() {
      const nodes = document.querySelectorAll(
        '#verificationCodeInput, #VerificationCodeInput, #proofConfirmation, #ProofConfirmation, #token, #otc, #otp, #otpCode, #code, #Code, #securityCode, input[name="VerificationCode"], input[name="verificationCode"], input[name="verification_code"], input[name="ProofConfirmation"], input[name="proofConfirmation"], input[name="token"], input[name="otc"], input[name="otp"], input[name="otpCode"], input[name="code"], input[name="Code"], input[name="Otp"], input[name="securityCode"], input[autocomplete="one-time-code"], input[type="tel"], input[inputmode="numeric"]'
      );
      const result = [];
      for (let i = 0; i < nodes.length; i++) {
        if (isVisible(nodes[i])) result.push(nodes[i]);
      }
      return result;
    }
    function hasVerificationOptions() {
      return Boolean(
        document.querySelector('a[id^="verificationOption"]')
        || document.getElementById('viewDetailsLink')
      );
    }
    function setInputValue(el, value) {
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      try {
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: String(value).slice(-1) || '0' }));
      } catch (e) {}
      el.blur();
    }
    function submitPostback(eventTarget) {
      const form = document.getElementById('loginForm') || document.querySelector('form');
      if (!form) return false;
      let target = form.querySelector('input[name="__EVENTTARGET"]');
      if (!target) {
        target = document.createElement('input');
        target.type = 'hidden';
        target.name = '__EVENTTARGET';
        form.appendChild(target);
      }
      target.value = eventTarget;
      let arg = form.querySelector('input[name="__EVENTARGUMENT"]');
      if (!arg) {
        arg = document.createElement('input');
        arg.type = 'hidden';
        arg.name = '__EVENTARGUMENT';
        form.appendChild(arg);
      }
      arg.value = '';
      form.submit();
      return true;
    }
    function triggerOption(id) {
      const el = document.getElementById(id);
      if (!el) return false;
      try { el.click(); return true; } catch (e) {}
      return submitPostback(id);
    }
    function clickSubmit() {
      const submit = document.getElementById('signInButton')
        || document.getElementById('signInConfirm')
        || document.getElementById('signIn')
        || document.querySelector('input[type="submit"][name="SignIn"], input[name="SignIn"], #submitButton, input[type="submit"], button[type="submit"]');
      if (submit) {
        if (submit.disabled) submit.disabled = false;
        submit.click();
        return true;
      }
      const buttons = document.querySelectorAll('button, input[type="button"]');
      for (let i = 0; i < buttons.length; i++) {
        const label = (buttons[i].innerText || buttons[i].value || buttons[i].textContent || '').toLowerCase();
        if (/zaloguj|sign in|verify|weryfikuj|dalej|next|continue|kontynuuj/.test(label)) {
          if (buttons[i].disabled) buttons[i].disabled = false;
          buttons[i].click();
          return true;
        }
      }
      const roleButtons = document.querySelectorAll('[role="button"], .submit, span[id*="submit"], div[id*="submit"]');
      for (let i = 0; i < roleButtons.length; i++) {
        const label = (roleButtons[i].innerText || roleButtons[i].value || roleButtons[i].textContent || '').toLowerCase();
        const id = String(roleButtons[i].id || '').toLowerCase();
        if (/signin|submit|confirm|zaloguj|verify|weryfikuj|dalej|next|continue|kontynuuj/.test(id + ' ' + label)) {
          roleButtons[i].click();
          return true;
        }
      }
      const form = document.getElementById('loginForm') || document.querySelector('form');
      if (form) {
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
        return true;
      }
      return false;
    }
    function submitCode(code) {
      const codeInputs = findVisibleCodeInputs();
      if (!codeInputs.length) return false;
      window.__usosUjMfaBusy = true;
      if (codeInputs.length > 1 && codeInputs.every(function (input) {
        const maxLength = Number(input.maxLength || input.getAttribute('maxlength') || 1);
        return maxLength === 1;
      })) {
        const chars = String(code).split('');
        for (let i = 0; i < codeInputs.length && i < chars.length; i++) {
          setInputValue(codeInputs[i], chars[i]);
        }
      } else {
        setInputValue(codeInputs[0], code);
      }
      setTimeout(function () {
        const clicked = clickSubmit();
        window.__usosUjMfaBusy = false;
        const pageHtml = document.documentElement.innerHTML || '';
        const errorDiv = document.getElementById('errorDiv');
        const errorText = ((document.getElementById('errorText') || {}).textContent || '').trim();
        const rejected = /Wprowadzony kod weryfikacyjny|różni się od oczekiwanego|rozni sie od oczekiwanego|invalid verification/i.test(pageHtml)
          || (errorDiv && errorDiv.style.display !== 'none' && (errorText || /display:\s*block/i.test(errorDiv.getAttribute('style') || '')));
        if (rejected) {
          post({
            type: 'usos-mfa',
            state: 'mfa_failed',
            message: (errorText || 'Kod weryfikacyjny odrzucony.').slice(0, 240)
          });
          return;
        }
        post({ type: 'usos-mfa', state: 'code_submitted', submitClicked: clicked, inputCount: codeInputs.length });
      }, 550);
      return true;
    }
    function selectSmsOption() {
      const links = document.querySelectorAll('a[id^="verificationOption"]');
      for (let i = 0; i < links.length; i++) {
        const label = (links[i].innerText || links[i].textContent || '').toLowerCase();
        if (/sms|wyślij|wyslij|text me|telefon|phone|mobile/.test(label)) {
          window.__usosUjMfaBusy = true;
          const id = links[i].id;
          if (id) triggerOption(id);
          else links[i].click();
          setTimeout(function () {
            window.__usosUjMfaBusy = false;
            post({ type: 'usos-mfa', state: 'sms_selected' });
          }, 900);
          return true;
        }
      }
      const fallback = document.getElementById('verificationOption0') || document.getElementById('verificationOption1');
      if (fallback) {
        window.__usosUjMfaBusy = true;
        triggerOption(fallback.id);
        setTimeout(function () {
          window.__usosUjMfaBusy = false;
          post({ type: 'usos-mfa', state: 'sms_selected' });
        }, 900);
        return true;
      }
      if (document.getElementById('viewDetailsLink')) {
        window.__usosUjMfaBusy = true;
        triggerOption('viewDetailsLink');
        setTimeout(function () {
          window.__usosUjMfaBusy = false;
          post({ type: 'usos-mfa', state: 'sms_selected' });
        }, 900);
        return true;
      }
      const optionLinks = document.querySelectorAll('#authOptionLinks a, #authOptions a.actionLink, #authOptions a');
      for (let i = 0; i < optionLinks.length; i++) {
        const label = (optionLinks[i].innerText || optionLinks[i].textContent || '').toLowerCase();
        if (!/sms|wyślij|wyslij|text me|telefon|phone|mobile/.test(label)) continue;
        window.__usosUjMfaBusy = true;
        const onclick = optionLinks[i].getAttribute('onclick') || '';
        const selectMatch = onclick.match(/SelectOption\\s*\\(\\s*['"]([^'"]+)['"]/i);
        if (selectMatch && typeof window.SelectOption === 'function') {
          window.SelectOption(selectMatch[1]);
        } else {
          optionLinks[i].click();
        }
        setTimeout(function () {
          window.__usosUjMfaBusy = false;
          post({ type: 'usos-mfa', state: 'sms_selected' });
        }, 900);
        return true;
      }
      return false;
    }
    const code = ${codeJson};

    if (code) {
      if (submitCode(code)) return true;
      if (hasVerificationOptions()) {
        post({ type: 'usos-mfa', state: 'waiting_code_input' });
        return true;
      }
      if (triggerOption('viewDetailsLink')) {
        post({ type: 'usos-mfa', state: 'form_revealed' });
        return true;
      }
      post({ type: 'usos-mfa', state: 'waiting_code_input' });
      return true;
    }

    if (hasVerificationOptions()) {
      if (selectSmsOption()) return true;
    }

    if (findVisibleCodeInput()) {
      post({ type: 'usos-mfa', state: 'needs_code' });
      return true;
    }

    post({ type: 'usos-mfa', state: 'needs_code' });
    return true;
  `;
}

/** MFA na stronie ADFS UJ (sts.uj.edu.pl) — wybór SMS, odsłonięcie pola kodu, wysłanie kodu. */
export function buildUjAdfsMfaScript(mfaCode = '') {
  const codeJson = JSON.stringify(String(mfaCode || '').trim());

  return `(function () {
    const pendingCode = ${codeJson};
    if (window.__usosUjMfaBusy && !pendingCode) return true;
    ${ujAdfsMfaScriptCore(codeJson)}
  })(); true;`;
}

export function buildUjAdfsLoginFlowScript(login, password, mfaCode = '') {
  const userJson = JSON.stringify(String(login || ''));
  const passJson = JSON.stringify(String(password || ''));
  const codeJson = JSON.stringify(String(mfaCode || '').trim());

  return `(function () {
    const pendingCode = ${codeJson};
    if (window.__usosUjMfaBusy && !pendingCode) return true;
    function post(payload) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      } catch (e) {}
    }
    function isVisible(el) {
      if (!el || el.type === 'hidden' || el.disabled) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }
    function hasMfaUi() {
      return Boolean(
        document.querySelector('a[id^="verificationOption"]')
        || document.getElementById('viewDetailsLink')
        || document.getElementById('verificationCodeInput')
        || document.querySelector('input[name="VerificationCode"], input[name="verificationCode"], input[name="token"], input[name="otc"]')
      );
    }
    function setInputValue(el, value) {
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      try {
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: String(value).slice(-1) || '0' }));
      } catch (e) {}
      el.blur();
    }

    if (hasMfaUi()) {
      ${ujAdfsMfaScriptCore(codeJson)}
      return true;
    }

    if (window.__usosAdfsSubmitDone) return true;
    const user = document.querySelector('#userNameInput, input[name="UserName"]');
    const pass = document.querySelector('#passwordInput, input[name="Password"]');
    const form = document.querySelector('#loginForm, form');
    if (!user || !pass || !form) return true;
    setInputValue(user, ${userJson});
    setInputValue(pass, ${passJson});
    window.__usosAdfsSubmitDone = true;
    setTimeout(function () {
      const submit = document.getElementById('submitButton')
        || document.querySelector('input[type="submit"], button[type="submit"]');
      if (submit) {
        if (submit.disabled) submit.disabled = false;
        submit.click();
      } else if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
    }, 350);
    return true;
  })(); true;`;
}

/** Wybór SMS/telefonu lub wysłanie kodu 2FA w tej samej sesji WebView. */
export function buildMfaStepScript(mfaCode = '', url = '', portalUrl = '') {
  const trimmedCode = String(mfaCode || '').trim();
  if (isUjAdfsUrl(url) || isUjPortal(portalUrl)) {
    return buildUjAdfsMfaScript(trimmedCode);
  }

  const codeJson = JSON.stringify(trimmedCode);

  return `(function () {
    if (window.__usosMfaBusy) return true;
    function post(payload) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      } catch (e) {}
    }
    const code = ${codeJson};
    const codeInput = document.querySelector(
      '#verificationCodeInput, #token, #otc, input[name="token"], input[name="VerificationCode"], input[name="otc"], input[name="code"], input[name="Code"], input[name="Otp"]'
    );

    if (code) {
      if (codeInput) {
        window.__usosMfaBusy = true;
        codeInput.focus();
        codeInput.value = code;
        codeInput.dispatchEvent(new Event('input', { bubbles: true }));
        codeInput.dispatchEvent(new Event('change', { bubbles: true }));
        const form = codeInput.closest('form') || document.getElementById('loginForm') || document.querySelector('form');
        setTimeout(function () {
          const submit = document.getElementById('signInButton')
            || document.getElementById('signInConfirm')
            || document.getElementById('submitButton')
            || (form && form.querySelector('input[type="submit"], button[type="submit"], #submit'));
          if (submit) submit.click();
          else if (form) form.submit();
          window.__usosMfaBusy = false;
          post({ type: 'usos-mfa', state: 'code_submitted' });
        }, 400);
        return true;
      }
      const viewDetails = document.getElementById('viewDetailsLink');
      if (viewDetails) {
        viewDetails.click();
        post({ type: 'usos-mfa', state: 'form_revealed' });
        return true;
      }
      post({ type: 'usos-mfa', state: 'waiting_code_input' });
      return true;
    }

    if (codeInput) {
      post({ type: 'usos-mfa', state: 'needs_code' });
      return true;
    }

    const links = document.querySelectorAll('a[id^="verificationOption"]');
    for (let i = 0; i < links.length; i++) {
      const label = (links[i].innerText || links[i].textContent || '').toLowerCase();
      if (/sms|wyślij|wyslij|text me|telefon|phone|mobile/.test(label)) {
        window.__usosMfaBusy = true;
        links[i].click();
        setTimeout(function () {
          window.__usosMfaBusy = false;
          post({ type: 'usos-mfa', state: 'sms_selected' });
        }, 300);
        return true;
      }
    }

    const fallback = document.getElementById('verificationOption0') || document.getElementById('verificationOption1');
    if (fallback) {
      window.__usosMfaBusy = true;
      fallback.click();
      setTimeout(function () {
        window.__usosMfaBusy = false;
        post({ type: 'usos-mfa', state: 'sms_selected' });
      }, 300);
      return true;
    }

    const viewDetails = document.getElementById('viewDetailsLink');
    if (viewDetails) {
      viewDetails.click();
      post({ type: 'usos-mfa', state: 'sms_selected' });
      return true;
    }

    post({ type: 'usos-mfa', state: 'needs_code' });
    return true;
  })(); true;`;
}

export function isCasLoginPageUrl(url) {
  const value = String(url || '');
  return /\/cas\/login/i.test(value) || /login\.umcs\.pl\/login/i.test(value);
}

export function buildCasAutofillScript(login, password) {
  const userJson = JSON.stringify(normalizeUmcsLogin(login));
  const passJson = JSON.stringify(String(password || ''));

  return `(function () {
    if (window.__usosCasAutofillTimer) return true;
    function onCasPage() {
      const href = String(window.location.href || '');
      return /\\/cas\\/login/i.test(href) || /login\\.umcs\\.pl\\/login/i.test(href);
    }
    if (!onCasPage()) return true;
    function post(payload) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      } catch (e) {}
    }
    function stopTimer(reportMissing) {
      if (window.__usosCasAutofillTimer) {
        clearInterval(window.__usosCasAutofillTimer);
        window.__usosCasAutofillTimer = null;
      }
      if (reportMissing && !window.__usosCasSubmitDone && onCasPage()) {
        post({ type: 'usos-cas', state: 'form_missing' });
      }
    }
    function fingerprint() {
      const fp = document.querySelector('input[name="deviceFingerprint"]');
      if (fp && !fp.value) {
        fp.value = String(Math.abs([...(navigator.userAgent || 'android')].reduce(function (a, c) {
          return ((a << 5) - a + c.charCodeAt(0)) | 0;
        }, 0)));
      }
    }
    function trySubmit() {
      if (window.__usosCasSubmitDone) return true;
      if (!onCasPage()) {
        stopTimer(false);
        return true;
      }
      const pass = document.querySelector([
        '#password',
        'input[name="password"]',
        'input[name="Password"]',
        'input[name="j_password"]',
        'input[name="pass"]',
        'input[autocomplete="current-password"]',
        'input[type="password"]'
      ].join(', '));
      const form = (pass && pass.closest('form'))
        || document.querySelector('#fm1, #loginForm, form[action*="login"], form');
      const userScope = form || document;
      const user = userScope.querySelector([
        '#username',
        '#login',
        '#userNameInput',
        'input[name="username"]',
        'input[name="UserName"]',
        'input[name="login"]',
        'input[name="Login"]',
        'input[name="j_username"]',
        'input[name="user"]',
        'input[name="email"]',
        'input[autocomplete="username"]',
        'input[type="email"]',
        'input[id*="login" i]',
        'input[id*="user" i]',
        'input[name*="login" i]',
        'input[name*="user" i]'
      ].join(', '));
      if (!user || !pass || !form) return false;
      fingerprint();
      const setValue = (el, value) => {
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        try {
          el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: String(value).slice(-1) || 'a' }));
        } catch (e) {}
        el.blur();
      };
      setValue(user, ${userJson});
      setValue(pass, ${passJson});
      window.__usosCasSubmitDone = true;
      post({ type: 'usos-cas', state: 'form_submitted' });
      setTimeout(function () {
        const submit = form.querySelector('#submitBtn, button[type="submit"], input[type="submit"], input[name="submitBtn"], button[name="submit"]');
        if (submit) submit.click();
        else form.submit();
      }, 350);
      return true;
    }
    let attempts = 0;
    window.__usosCasAutofillTimer = setInterval(function () {
      attempts += 1;
      if (!onCasPage()) {
        stopTimer(false);
        return;
      }
      if (trySubmit() || attempts >= 36) {
        stopTimer(!window.__usosCasSubmitDone);
      }
    }, 400);
    return true;
  })(); true;`;
}

/** Obsługa logowania UMCS: CAS → wybór MFA → SMS → kod OTP. */
export function buildUmcsLoginFlowScript(login, password, mfaCode = '') {
  const loginJson = JSON.stringify(normalizeUmcsLogin(login));
  const passJson = JSON.stringify(String(password || ''));
  const codeJson = JSON.stringify(String(mfaCode || '').trim());

  return `(function () {
    if (window.__usosUmcsFlowBusy) return true;
    function post(payload) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      } catch (e) {}
    }
    const code = ${codeJson};

    const tokenInput = document.querySelector('#token, input[name="token"]');
    if (tokenInput && /password|text|tel/i.test(tokenInput.type || 'text')) {
      if (!code) {
        post({ type: 'usos-mfa', state: 'needs_code' });
        return true;
      }
      window.__usosUmcsFlowBusy = true;
      tokenInput.focus();
      tokenInput.value = code;
      tokenInput.dispatchEvent(new Event('input', { bubbles: true }));
      tokenInput.dispatchEvent(new Event('change', { bubbles: true }));
      const tokenForm = tokenInput.closest('form') || document.getElementById('fm1');
      setTimeout(function () {
        const submit = (tokenForm && tokenForm.querySelector('button[type="submit"], #submitBtn'))
          || document.getElementById('submitBtn');
        if (submit) submit.click();
        else if (tokenForm) tokenForm.submit();
        window.__usosUmcsFlowBusy = false;
        post({ type: 'usos-mfa', state: 'code_submitted' });
      }, 400);
      return true;
    }

    if (document.getElementById('continueButton') && document.querySelector('input[type="checkbox"]')) {
      if (window.__usosUmcsChannelSelected) return true;
      const boxes = document.querySelectorAll('input[type="checkbox"]');
      let target = null;
      for (let i = 0; i < boxes.length; i++) {
        const label = (boxes[i].closest('.mdc-form-field, .form-check') || {}).innerText || '';
        if (/e-mail|email|\\*@|@\\*|mail/i.test(label)) {
          target = boxes[i];
          break;
        }
      }
      for (let i = 0; i < boxes.length && !target; i++) {
        const label = (boxes[i].closest('.mdc-form-field, .form-check') || {}).innerText || '';
        if (/mobilny usos|telefon|phone|sms/i.test(label)) {
          target = boxes[i];
          break;
        }
      }
      if (!target && boxes.length) target = boxes[0];
      if (!target) return true;
      window.__usosUmcsFlowBusy = true;
      window.__usosUmcsChannelSelected = true;
      target.checked = true;
      target.dispatchEvent(new Event('change', { bubbles: true }));
      setTimeout(function () {
        document.getElementById('continueButton').click();
        window.__usosUmcsFlowBusy = false;
        post({ type: 'usos-mfa', state: 'sms_selected' });
      }, 400);
      return true;
    }

    if (document.getElementById('fm-mfa-simple') || /Multifactor Provider Selection/i.test(document.title || '')) {
      if (window.__usosUmcsProviderSelected) return true;
      window.__usosUmcsFlowBusy = true;
      window.__usosUmcsProviderSelected = true;
      setTimeout(function () {
        const btn = document.getElementById('btn-mfa-simple')
          || document.querySelector('#fm-mfa-simple button[type="submit"]');
        if (btn) btn.click();
        else {
          const form = document.getElementById('fm-mfa-simple');
          if (form) form.submit();
        }
        window.__usosUmcsFlowBusy = false;
        post({ type: 'usos-mfa', state: 'sms_selected' });
      }, 400);
      return true;
    }

    const user = document.querySelector('#username, input[name="username"]');
    const pass = document.querySelector('#password, input[name="password"]');
    const form = document.querySelector('#fm1, form[action*="login"]');
    if (!user || !pass || !form) return true;
    if (window.__usosCasSubmitDone) return true;
    const fp = document.querySelector('input[name="deviceFingerprint"]');
    if (fp && !fp.value) {
      fp.value = String(Math.abs([...(navigator.userAgent || 'android')].reduce(function (a, c) {
        return ((a << 5) - a + c.charCodeAt(0)) | 0;
      }, 0)));
    }
    user.focus();
    user.value = ${loginJson};
    pass.value = ${passJson};
    user.dispatchEvent(new Event('input', { bubbles: true }));
    pass.dispatchEvent(new Event('input', { bubbles: true }));
    window.__usosCasSubmitDone = true;
    setTimeout(function () {
      const submit = form.querySelector('#submitBtn, button[type="submit"], input[type="submit"]');
      if (submit) submit.click();
      else form.submit();
    }, 500);
    return true;
  })(); true;`;
}

export function buildAdfsAutofillScript(login, password) {
  const userJson = JSON.stringify(String(login || ''));
  const passJson = JSON.stringify(String(password || ''));

  return `(function () {
    if (window.__usosAdfsSubmitDone) return true;
    const user = document.querySelector('#userNameInput, input[name="UserName"]');
    const pass = document.querySelector('#passwordInput, input[name="Password"]');
    const form = document.querySelector('#loginForm, form');
    if (!user || !pass || !form) return true;
    user.value = ${userJson};
    pass.value = ${passJson};
    window.__usosAdfsSubmitDone = true;
    setTimeout(function () {
      const submit = document.getElementById('submitButton') || form.querySelector('[type="submit"]');
      if (submit) submit.click();
      else form.submit();
    }, 350);
    return true;
  })(); true;`;
}

export function buildGenericAdfsAutofillScript(login, password) {
  const userJson = JSON.stringify(String(login || ''));
  const passJson = JSON.stringify(String(password || ''));

  return `(function () {
    function post(payload) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      } catch (e) {}
    }
    function isVisible(el) {
      if (!el || el.disabled) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }
    function setInputValue(el, value) {
      if (!el) return;
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    }
    const user = document.querySelector('#userNameInput, input[name="UserName"], input[name="username"], #username');
    const userHolder = document.querySelector('#userNameInputHolder, #userNameInputOptionsHolder, input[type="hidden"][name="UserName"]');
    const pass = document.querySelector('#passwordInput, input[name="Password"], input[type="password"]');
    const next = document.getElementById('nextButton');
    const submit = document.getElementById('submitButton') || document.querySelector('input[type="submit"], button[type="submit"]');

    if (user && isVisible(user) && !window.__usosAdfsUsernameDone) {
      setInputValue(user, ${userJson});
      setInputValue(userHolder, ${userJson});
      window.__usosAdfsUsernameDone = true;
      post({ type: 'usos-cas', state: 'username_submitted' });
      if (next) {
        setTimeout(function () { next.click(); }, 250);
        return true;
      }
    }

    if (pass && !window.__usosAdfsPasswordDone) {
      setInputValue(userHolder || user, ${userJson});
      setInputValue(pass, ${passJson});
      window.__usosAdfsPasswordDone = true;
      post({ type: 'usos-cas', state: 'form_submitted' });
      setTimeout(function () {
        if (submit) submit.click();
        else {
          const form = pass.closest('form') || document.querySelector('form');
          if (form) form.submit();
        }
      }, 300);
      return true;
    }
    return true;
  })(); true;`;
}

export function buildKeycloakAutofillScript(login, password) {
  const userJson = JSON.stringify(String(login || ''));
  const passJson = JSON.stringify(String(password || ''));

  return `(function () {
    function post(payload) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      } catch (e) {}
    }
    function setInputValue(el, value) {
      if (!el) return;
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    }
    const user = document.querySelector('#username, input[name="username"], input[name="login"], input[type="email"]');
    const pass = document.querySelector('#password, input[name="password"], input[type="password"]');
    const submit = document.querySelector('#kc-login, input[name="login"], button[type="submit"], input[type="submit"]');

    if (pass && !window.__usosKeycloakPasswordDone) {
      if (user) setInputValue(user, ${userJson});
      setInputValue(pass, ${passJson});
      window.__usosKeycloakPasswordDone = true;
      post({ type: 'usos-cas', state: 'form_submitted' });
      setTimeout(function () { if (submit) submit.click(); else pass.closest('form')?.submit(); }, 300);
      return true;
    }

    if (user && !window.__usosKeycloakUsernameDone) {
      setInputValue(user, ${userJson});
      window.__usosKeycloakUsernameDone = true;
      post({ type: 'usos-cas', state: 'username_submitted' });
      setTimeout(function () { if (submit) submit.click(); else user.closest('form')?.submit(); }, 300);
      return true;
    }
    return true;
  })(); true;`;
}

export function buildMicrosoftEntraAutofillScript(login, password) {
  const userJson = JSON.stringify(String(login || ''));
  const passJson = JSON.stringify(String(password || ''));

  return `(function () {
    function post(payload) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      } catch (e) {}
    }
    function setInputValue(el, value) {
      if (!el) return;
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      try {
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: String(value).slice(-1) || 'a' }));
      } catch (e) {}
      el.blur();
    }
    function click(el) {
      if (!el) return false;
      if (el.disabled) el.disabled = false;
      el.click();
      return true;
    }
    const user = document.querySelector('#i0116, input[name="loginfmt"], input[type="email"]');
    const pass = document.querySelector('#i0118, input[name="passwd"], input[type="password"]');
    const next = document.getElementById('idSIButton9')
      || document.querySelector('input[type="submit"], button[type="submit"]');

    if (pass && !window.__usosMsPasswordDone) {
      setInputValue(pass, ${passJson});
      window.__usosMsPasswordDone = true;
      post({ type: 'usos-cas', state: 'form_submitted' });
      setTimeout(function () { click(next); }, 350);
      return true;
    }

    if (user && !window.__usosMsUsernameDone) {
      setInputValue(user, ${userJson});
      window.__usosMsUsernameDone = true;
      post({ type: 'usos-cas', state: 'username_submitted' });
      setTimeout(function () { click(next); }, 350);
      return true;
    }

    const error = document.querySelector('#usernameError, #passwordError, #error, [role="alert"], .alert-error');
    const snippet = ((error && (error.innerText || error.textContent)) || document.body?.innerText || '').trim();
    if (/nieprawidłowa|nieprawidlowa|doesn.?t exist|couldn.?t find|incorrect|invalid|wrong password|nie znaleziono|nie istnieje/i.test(snippet)) {
      post({ type: 'usos-cas', state: 'auth_failed', message: snippet.slice(0, 240) });
    }
    return true;
  })(); true;`;
}

export function buildAutofillScript(login, password, url, mfaCode = '') {
  if (isMicrosoftEntraLoginUrl(url)) {
    return buildMicrosoftEntraAutofillScript(login, password);
  }
  if (isKeycloakLoginUrl(url)) {
    return buildKeycloakAutofillScript(login, password);
  }
  if (isUjAdfsUrl(url)) {
    return buildUjAdfsLoginFlowScript(login, password, mfaCode);
  }
  if (isUmcsLoginHost(url)) {
    return buildUmcsLoginFlowScript(login, password, mfaCode);
  }
  if (isAdfsLoginUrl(url)) {
    return buildGenericAdfsAutofillScript(login, password);
  }
  return buildCasAutofillScript(login, password);
}

/** Wykrywa błąd logowania na stronie CAS PW/UJ. */
export function buildCasFailureProbeScript() {
  return `(function () {
    function post(payload) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      } catch (e) {}
    }
    const body = document.querySelector('.message-body, #msg, .errors, #loginErrors, .banner-danger, .alert-error, #input-error, #usernameError, #passwordError, #error, [role="alert"]');
    const snippet = ((body && (body.innerText || body.textContent)) || document.body?.innerText || '').trim();
    if (/nie mogą|nie może|authentication failed|invalid credentials|błędne|incorrect|nie powiodło|nieprawidłowa nazwa użytkownika|doesn.?t exist|couldn.?t find|wrong password/i.test(snippet)) {
      post({ type: 'usos-cas', state: 'auth_failed', message: snippet.slice(0, 240) });
    }
    return true;
  })(); true;`;
}

/**
 * Po powrocie z CAS: auto-submit formularza ticket/SAML i wykrycie aktywnej sesji USOSweb.
 */
export function buildPortalHandshakeScript(portalUrl) {
  const homeUrl = `${portalUrl.replace(/\/$/, '')}/kontroler.php?_action=home/index`;
  const portalHost = portalHostFromUrl(portalUrl);

  return `(function () {
    if (window.__usosPortalHandshakeBusy) return true;
    function post(payload) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      } catch (e) {}
    }
    const host = window.location.hostname || '';
    if (host !== ${JSON.stringify(portalHost)}) return true;

    const html = document.documentElement.innerHTML || '';
    const userMatch = html.match(/user_id:\\s*(\\d+|null)/i);
    const userId = userMatch ? userMatch[1] : '';
    const loginWall = userId === 'null' || (/login-url=["']/.test(html) && !/wyloguj/i.test(html));

    const forms = document.querySelectorAll('form[action]');
    for (let i = 0; i < forms.length; i++) {
      const form = forms[i];
      if (!form.querySelector('input[type="hidden"][name]')) continue;
      const action = form.getAttribute('action') || '';
      if (/logowaniecas|cas\\//i.test(action) || /SAMLResponse|RelayState|wresult|ticket=/i.test(html)) {
        window.__usosPortalHandshakeBusy = true;
        setTimeout(function () {
          form.submit();
          window.__usosPortalHandshakeBusy = false;
          post({ type: 'usos-portal', state: 'auto_post_submitted' });
        }, 350);
        return true;
      }
    }

    if (userId && userId !== 'null' && !loginWall) {
      post({ type: 'usos-portal', state: 'logged_in' });
      return true;
    }

    if (loginWall && !window.__usosHomeNavDone) {
      window.__usosHomeNavDone = true;
      post({ type: 'usos-portal', state: 'navigating_home' });
      window.location.href = ${JSON.stringify(homeUrl)};
      return true;
    }

    post({ type: 'usos-portal', state: loginWall ? 'login_wall' : 'pending' });
    return true;
  })(); true;`;
}

export function getPlanExportPageUrl(portalUrl) {
  return `${portalUrl.replace(/\/$/, '')}/kontroler.php?_action=home/eksportujPlan`;
}

export function getPlanSchedulePageUrl(portalUrl) {
  return `${portalUrl.replace(/\/$/, '')}/kontroler.php?_action=home/plan`;
}

export function getUsosHomePageUrl(portalUrl) {
  return `${portalUrl.replace(/\/$/, '')}/kontroler.php?_action=home/index`;
}

export function getUsosGrupyPageUrl(portalUrl) {
  return `${portalUrl.replace(/\/$/, '')}/kontroler.php?_action=dla_stud/studia/grupyDziekanskie`;
}

export function getUsosRankingPageUrl(portalUrl) {
  return `${portalUrl.replace(/\/$/, '')}/kontroler.php?_action=dla_stud/studia/rankingi`;
}

export function getUsosGrupyZajeciowePageUrl(portalUrl) {
  return `${portalUrl.replace(/\/$/, '')}/kontroler.php?_action=home/grupy`;
}

export function usosWebViewUserAgent() {
  if (Platform.OS === 'ios') {
    return 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  }
  return 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
}

export function isUsosHomeIndexUrl(url, portalUrl) {
  return isUsosPortalHostUrl(url, portalUrl) && /_action=home\/index/i.test(String(url || ''));
}

export function isUsosGrupyPageUrl(url) {
  return /_action=dla_stud\/studia\/grupyDziekanskie/i.test(String(url || ''));
}

export function isUsosRankingPageUrl(url) {
  return /_action=dla_stud\/studia\/rankingi/i.test(String(url || ''));
}

export function isUsosGrupyZajeciowePageUrl(url) {
  return /_action=home\/grupy/i.test(String(url || ''));
}

export function isUsosExportPlanUrl(url) {
  return /_action=home\/eksportujPlan/i.test(String(url || ''));
}

export function isUsosPlanPageUrl(url) {
  return /_action=home\/plan(?:&|$)/i.test(String(url || ''));
}

/** Zapisuje HTML bieżącej strony po pełnym renderze (custom elements USOS). */
export function buildCaptureProfilePageScript(pageKey, renderDelayMs = 700) {
  const key = JSON.stringify(pageKey);
  const delay = Math.max(300, Number(renderDelayMs) || 700);
  return `(function () {
    var pageKey = ${key};
    var renderDelay = ${delay};
    window.__usosProfileCaptureSent = window.__usosProfileCaptureSent || {};
    function send() {
      if (window.__usosProfileCaptureSent[pageKey]) return;
      window.__usosProfileCaptureSent[pageKey] = true;
      try {
        var html = document.documentElement.innerHTML || '';
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'usos-profile-page',
          page: pageKey,
          html: html.slice(0, 600000)
        }));
      } catch (e) {}
    }
    if (document.readyState === 'complete') {
      setTimeout(send, renderDelay);
    } else {
      window.addEventListener('load', function () { setTimeout(send, renderDelay); }, { once: true });
    }
    return true;
  })(); true;`;
}

export function buildNavigateScript(nextUrl) {
  return `window.location.href=${JSON.stringify(nextUrl)}; true;`;
}

/** Pobiera HTML profilu (home, grupy dziekańskie, grupy zajęciowe) przez fetch w sesji WebView. */
export function buildFetchUsosStudentProfileScript(portalUrl) {
  const base = String(portalUrl || '').replace(/\/$/, '');
  const homeUrl = `${base}/kontroler.php?_action=home/index`;
  const grupyUrl = `${base}/kontroler.php?_action=dla_stud/studia/grupyDziekanskie`;
  const grupyZajecioweUrl = `${base}/kontroler.php?_action=home/grupy`;

  return `(function () {
    if (window.__usosProfileFetchStarted) return true;
    window.__usosProfileFetchStarted = true;
    function sleep(ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }
    function fetchOpts(referer) {
      return {
        credentials: 'include',
        headers: {
          Accept: 'text/html,*/*',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: referer
        }
      };
    }
    (async function () {
      var homeHtml = '';
      var grupyHtml = '';
      var grupyZajecioweHtml = '';
      var error = '';
      try {
        for (var attempt = 0; attempt < 4; attempt += 1) {
          if (attempt > 0) await sleep(700 + attempt * 350);
          var homeResp = await fetch(${JSON.stringify(homeUrl)}, fetchOpts(${JSON.stringify(homeUrl)}));
          homeHtml = await homeResp.text();
          if (!/logged-user|Numer albumu|usos-frame|cas-bar/i.test(homeHtml)) continue;
          var grupyResp = await fetch(${JSON.stringify(grupyUrl)}, fetchOpts(${JSON.stringify(homeUrl)}));
          var grupyZajecioweResp = await fetch(${JSON.stringify(grupyZajecioweUrl)}, fetchOpts(${JSON.stringify(homeUrl)}));
          if (grupyResp.ok) grupyHtml = await grupyResp.text();
          if (grupyZajecioweResp.ok) grupyZajecioweHtml = await grupyZajecioweResp.text();
          if (homeHtml && (grupyHtml || grupyZajecioweHtml)) break;
        }
      } catch (e) {
        error = String(e && e.message ? e.message : e);
      }
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'usos-profile-fetch',
          homeHtml: homeHtml.slice(0, 600000),
          grupyHtml: grupyHtml.slice(0, 600000),
          grupyZajecioweHtml: grupyZajecioweHtml.slice(0, 600000),
          error: error
        }));
      } catch (e) {}
    })();
    return true;
  })(); true;`;
}

/** @deprecated Użyj buildCaptureProfilePageScript + buildNavigateScript osobno. */
export function buildCaptureProfileAndNavigateScript(pageKey, nextUrl) {
  return `${buildCaptureProfilePageScript(pageKey)} setTimeout(function () {
    window.location.href = ${JSON.stringify(nextUrl)};
  }, 1100); true;`;
}

/** Wyciąga iCal z załadowanego modala eksportu (DOM + HTML). */
export function buildExtractIcalFromDomScript() {
  const extractFn = buildWebViewIcalExtractSource();
  return `(function () {
    var extractUsosIcalUrl = ${extractFn};
    try {
      var html = document.documentElement.innerHTML || document.body.innerHTML || '';
      var url = extractUsosIcalUrl(html);
      if (!url) {
        var field = document.getElementById('plan_export_link')
          || document.querySelector('text-field[id="plan_export_link"]');
        if (field) {
          url = String(field.value || field.getAttribute('value') || '').replace(/&amp;/g, '&');
        }
      }
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'usos-ical',
        url: url || '',
        exportHtmlLength: html.length
      }));
    } catch (e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'usos-ical',
        url: '',
        error: String(e && e.message ? e.message : e)
      }));
    }
    return true;
  })(); true;`;
}

/** @deprecated Używaj nawigacji WebView (startIcalPipeline). Zachowane jako zapas. */
export function buildFetchIcalInWebViewScript(portalUrl) {
  const planUrl = getPlanSchedulePageUrl(portalUrl);
  const exportUrl = getPlanExportPageUrl(portalUrl);
  const homeUrl = `${portalUrl.replace(/\/$/, '')}/kontroler.php?_action=home/index`;
  const grupyUrl = `${portalUrl.replace(/\/$/, '')}/kontroler.php?_action=dla_stud/studia/grupyDziekanskie`;
  const extractFn = buildWebViewIcalExtractSource();

  return `(function () {
    if (window.__usosIcalFetchStarted) return true;
    window.__usosIcalFetchStarted = true;
    var extractUsosIcalUrl = ${extractFn};
    function sleep(ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }
    function fetchOpts(referer) {
      return {
        credentials: 'include',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'text/html,*/*',
          Referer: referer
        }
      };
    }
    (async function () {
      try {
        var homeHtml = '';
        var planHtml = '';
        var exportHtml = '';
        var url = '';

        for (var attempt = 0; attempt < 4 && !url; attempt += 1) {
          if (attempt > 0) await sleep(700 + attempt * 400);

          var homeResp = await fetch(${JSON.stringify(homeUrl)}, fetchOpts(${JSON.stringify(homeUrl)}));
          homeHtml = await homeResp.text();
          var userId = (homeHtml.match(/user_id:\\s*"?([0-9]+)/i) || [])[1];
          if (!userId) continue;

          var planResp = await fetch(${JSON.stringify(planUrl)}, fetchOpts(${JSON.stringify(homeUrl)}));
          planHtml = await planResp.text();
          var exportResp = await fetch(${JSON.stringify(exportUrl)}, fetchOpts(${JSON.stringify(planUrl)}));
          exportHtml = await exportResp.text();
          url = extractUsosIcalUrl(exportHtml);
        }

        var grupyHtml = '';
        try {
          var grupyResp = await fetch(${JSON.stringify(grupyUrl)}, fetchOpts(${JSON.stringify(homeUrl)}));
          if (grupyResp.ok) grupyHtml = await grupyResp.text();
        } catch (e) {}

        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'usos-ical',
          url: url || '',
          debug: {
            hasPlanExportLink: /plan_export_link/i.test(exportHtml),
            exportLength: (exportHtml || '').length,
            planLength: (planHtml || '').length
          },
          studentProfile: { homeHtml: homeHtml, grupyHtml: grupyHtml }
        }));
      } catch (e) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'usos-ical',
          url: '',
          error: String(e && e.message ? e.message : e)
        }));
      }
    })();
    return true;
  })(); true;`;
}

export function cookieSyncUrlsForPortal(portalUrl) {
  const host = portalHostFromUrl(portalUrl);
  const urls = new Set([portalUrl]);
  if (/usos\.pw\.edu\.pl/i.test(host)) {
    urls.add('https://usosweb.usos.pw.edu.pl');
    urls.add('https://cas.usos.pw.edu.pl');
    urls.add('https://apps.usos.pw.edu.pl');
  }
  if (/umcs\.pl/i.test(host)) {
    urls.add('https://usosweb.umcs.pl');
    urls.add('https://login.umcs.pl');
    urls.add('https://usosapps.umcs.pl');
  }
  if (/uj\.edu\.pl/i.test(host)) {
    urls.add('https://www.usosweb.uj.edu.pl');
    urls.add('https://cas.uj.edu.pl');
    urls.add('https://apps.usos.uj.edu.pl');
    urls.add('https://sts.uj.edu.pl');
  }
  if (/amu\.edu\.pl/i.test(host)) {
    urls.add('https://usosweb.amu.edu.pl');
    urls.add('https://cas.amu.edu.pl');
    urls.add('https://usosapps.amu.edu.pl');
  }
  return [...urls];
}
