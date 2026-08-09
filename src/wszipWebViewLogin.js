/** Pomocnicze funkcje dla logowania Moodle WSZiP w WebView. */

export const WSZIP_WEBVIEW_LOGIN_TIMEOUT_MS = 300000;

export const MOODLE_BASE_URL = 'https://mdl.wszip.poznan.pl';
export const MOODLE_LOGIN_URL = `${MOODLE_BASE_URL}/login/index.php`;
export const MOODLE_HOME_URL = `${MOODLE_BASE_URL}/my/`;
export const MOODLE_PROFILE_URL = `${MOODLE_BASE_URL}/user/profile.php`;

export function moodleWebViewUserAgent() {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
}

export function isMoodleHost(url) {
  return /mdl\.wszip\.poznan\.pl/i.test(String(url || ''));
}

export function isGoogleAuthUrl(url) {
  return /accounts\.google\.com|google\.com\/o\/oauth|googleusercontent\.com/i.test(String(url || ''));
}

export function isMoodleLoginUrl(url) {
  const value = String(url || '');
  return isMoodleHost(value) && /\/login(?:\/|\.php)/i.test(value);
}

export function isMoodleLoggedInUrl(url) {
  const value = String(url || '');
  if (!isMoodleHost(value)) return false;
  if (isMoodleLoginUrl(value)) return false;
  return /\/my\/|\/course\/|\/user\/|\/mod\/|\/calendar\/|\/blocks\//i.test(value);
}

export function buildNavigateScript(nextUrl) {
  return `window.location.href = ${JSON.stringify(String(nextUrl || ''))}; true;`;
}

export function extractMoodleGoogleOAuthUrl(html, baseUrl = MOODLE_BASE_URL) {
  const source = String(html || '');
  const hrefMatch =
    source.match(/href="([^"]*\/auth\/oauth2\/login\.php[^"]*)"/i) ||
    source.match(/href='([^']*\/auth\/oauth2\/login\.php[^']*)'/i);
  if (!hrefMatch?.[1]) return '';

  try {
    return new URL(hrefMatch[1].replace(/&amp;/g, '&'), baseUrl).toString();
  } catch {
    return '';
  }
}

export function buildMoodleGoogleLoginClickScript() {
  return `
    (function () {
      function post(state, extra) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ type: 'wszip-moodle', state: state }, extra || {})));
        } catch (error) {}
      }

      function findGoogleLink() {
        var selectors = [
          'a.login-identityprovider-btn',
          'a[href*="/auth/oauth2/login.php"]',
          'a[href*="oauth2/login.php"]'
        ];
        for (var i = 0; i < selectors.length; i += 1) {
          var node = document.querySelector(selectors[i]);
          if (node) return node;
        }
        var links = Array.prototype.slice.call(document.querySelectorAll('a[href]'));
        return links.find(function (link) {
          var text = String(link.textContent || '');
          var href = String(link.getAttribute('href') || link.href || '');
          return /google/i.test(text) || /auth\\/oauth2\\/login\\.php/i.test(href);
        }) || null;
      }

      function tryOpenGoogle() {
        if (window.__wszipGoogleLinkClicked) return true;
        var google = findGoogleLink();
        if (!google) return false;

        var target = String(google.href || google.getAttribute('href') || '').trim();
        if (!target) return false;

        window.__wszipGoogleLinkClicked = true;
        post('google_link_clicked', { href: target });
        try {
          google.click();
        } catch (error) {
          window.location.href = target;
        }
        return true;
      }

      if (tryOpenGoogle()) return true;

      var attempts = Number(window.__wszipGoogleClickAttempts || 0);
      post('google_link_pending', {
        readyState: String(document.readyState || ''),
        attempt: attempts,
        links: document.querySelectorAll('a[href]').length
      });

      if (!window.__wszipGoogleClickTimer) {
        window.__wszipGoogleClickTimer = setInterval(function () {
          attempts += 1;
          window.__wszipGoogleClickAttempts = attempts;
          if (tryOpenGoogle()) {
            clearInterval(window.__wszipGoogleClickTimer);
            window.__wszipGoogleClickTimer = null;
            return;
          }
          if (attempts >= 40) {
            clearInterval(window.__wszipGoogleClickTimer);
            window.__wszipGoogleClickTimer = null;
            if (!window.__wszipGoogleLinkClicked) {
              post('google_link_missing', { attempts: attempts });
            }
          }
        }, 500);
      }
      return true;
    })();
    true;
  `;
}

export function buildGoogleOAuthLoginScript(email, password) {
  return `
    (function () {
      var email = ${JSON.stringify(String(email || ''))};
      var password = ${JSON.stringify(String(password || ''))};

      function post(state, extra) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ type: 'wszip-google', state: state }, extra || {})));
        } catch (error) {}
      }

      function setValue(input, value) {
        if (!input) return;
        var descriptor = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value');
        if (descriptor && descriptor.set) descriptor.set.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      function clickFirst(selectors) {
        var list = String(selectors || '').split(',');
        for (var i = 0; i < list.length; i += 1) {
          var node = document.querySelector(list[i].trim());
          if (node && !node.disabled && node.getAttribute('aria-disabled') !== 'true') {
            node.click();
            return true;
          }
        }
        return false;
      }

      function runEmailStep() {
        var emailInput = document.querySelector('#identifierId, input[type="email"], input[name="identifier"], input[autocomplete="username"]');
        if (!emailInput || emailInput.disabled) return false;
        setValue(emailInput, email);
        if (String(emailInput.value || '').trim().toLowerCase() !== String(email || '').trim().toLowerCase()) return false;
        if (!window.__wszipGoogleEmailDone) {
          window.__wszipGoogleEmailDone = true;
          post('email_submitted');
          clickFirst('#identifierNext, button[jsname="LgbsSe"], button[type="button"]');
        }
        return true;
      }

      function runPasswordStep() {
        var passwordInput = document.querySelector('input[type="password"], input[name="Passwd"], input[autocomplete="current-password"]');
        if (!passwordInput || passwordInput.disabled) return false;
        setValue(passwordInput, password);
        if (!String(passwordInput.value || '').length) return false;
        if (!window.__wszipGooglePasswordDone) {
          window.__wszipGooglePasswordDone = true;
          post('password_submitted');
          clickFirst('#passwordNext, button[jsname="LgbsSe"], button[type="button"]');
        }
        return true;
      }

      function runConsentStep() {
        var allow = document.querySelector('#submit_approve_access, button[data-idom-class*="nCPUpc"], button[jsname="LgbsSe"], button[type="submit"]');
        if (allow && !allow.disabled && !window.__wszipGoogleConsentDone) {
          window.__wszipGoogleConsentDone = true;
          post('consent_clicked');
          allow.click();
          return true;
        }
        return false;
      }

      try {
        if (!/accounts\\.google\\.com/i.test(String(window.location.hostname || ''))) return true;
        if (runEmailStep()) return true;
        if (runPasswordStep()) return true;
        if (runConsentStep()) return true;
        post('waiting_for_user', {
          title: String(document.title || ''),
          inputs: document.querySelectorAll('input').length
        });
      } catch (error) {
        post('error', { message: String(error && error.message || error) });
      }
      return true;
    })();
    true;
  `;
}

export function buildMoodleLoginProbeScript() {
  return `
    (function () {
      function post(state, extra) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ type: 'wszip-moodle', state: state }, extra || {})));
        } catch (error) {}
      }

      var href = String(window.location.href || '');
      var host = String(window.location.hostname || '').toLowerCase();

      if (/accounts\\.google\\.com|google\\.com$/i.test(host)) {
        post('google_auth');
        return true;
      }

      if (!/mdl\\.wszip\\.poznan\\.pl$/i.test(host)) return true;

      if (/\\/login(?:\\/|\\.php)/i.test(href)) {
        if (document.querySelector('a[href*="logout"]')) post('logged_in', { url: href });
        else post('login_page');
        return true;
      }

      if (document.querySelector('a[href*="logout"]')) {
        post('logged_in', { url: href });
      }
      return true;
    })();
    true;
  `;
}

export function buildMoodleCaptureHtmlScript(messageType) {
  const type = JSON.stringify(String(messageType || 'wszip-html'));
  return `
    (function () {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: ${type},
          url: String(window.location.href || ''),
          html: String(document.documentElement && document.documentElement.outerHTML || '').slice(0, 250000)
        }));
      } catch (error) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: ${type}, error: String(error && error.message || error) }));
      }
      return true;
    })();
    true;
  `;
}

export function buildMoodleFindPlansLinkScript() {
  return `
    (function () {
      function post(payload) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ type: 'wszip-plans-link' }, payload || {})));
        } catch (error) {}
      }

      var links = Array.prototype.slice.call(document.querySelectorAll('a[href]'));
      var plans = links.filter(function (link) {
        return /plany\\s*zaj/i.test(String(link.textContent || ''));
      });

      if (plans.length) {
        post({ found: true, url: plans[0].href, label: String(plans[0].textContent || '').trim() });
        return true;
      }

      var courseLinks = links.filter(function (link) {
        var text = String(link.textContent || '');
        return /plan/i.test(text) && /zaj/i.test(text) && /course|mod|category/i.test(String(link.href || ''));
      });
      if (courseLinks.length) {
        post({ found: true, url: courseLinks[0].href, label: String(courseLinks[0].textContent || '').trim() });
        return true;
      }

      post({ found: false, url: String(window.location.href || '') });
      return true;
    })();
    true;
  `;
}

export function buildMoodlePdfDownloadScript(pdfUrl, filename) {
  return `
    (function () {
      var url = ${JSON.stringify(String(pdfUrl || ''))};
      var filename = ${JSON.stringify(String(filename || 'wszip-plan.pdf'))};
      function post(payload) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ type: 'wszip-pdf-download' }, payload || {})));
        } catch (error) {}
      }
      if (!url) {
        post({ ok: false, error: 'Brak adresu PDF.' });
        return true;
      }
      fetch(url, { credentials: 'include', redirect: 'follow' })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.blob();
        })
        .then(function (blob) {
          var reader = new FileReader();
          reader.onloadend = function () {
            var dataUrl = String(reader.result || '');
            var base64 = dataUrl.indexOf(',') >= 0 ? dataUrl.split(',')[1] : '';
            if (!base64) {
              post({ ok: false, error: 'Nie udało się odczytać pliku PDF.' });
              return;
            }
            post({ ok: true, base64: base64, filename: filename, url: url });
          };
          reader.onerror = function () {
            post({ ok: false, error: 'Błąd odczytu pliku PDF.' });
          };
          reader.readAsDataURL(blob);
        })
        .catch(function (error) {
          post({ ok: false, error: String(error && error.message || error) });
        });
      return true;
    })();
    true;
  `;
}
