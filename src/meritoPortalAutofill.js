export function isMeritoLoginUrl(url) {
  const value = String(url || '');
  return /login\.wsb\.pl/i.test(value) && /\/cas\/login/i.test(value);
}

export function buildMeritoPortalAutofillScript(login, password) {
  const loginJson = JSON.stringify(String(login || '').trim());
  const passJson = JSON.stringify(String(password || ''));

  return `(function () {
    var login = ${loginJson};
    var password = ${passJson};

    function isLoginPage() {
      var href = String(window.location.href || '');
      var host = String(window.location.hostname || '').toLowerCase();
      return host === 'login.wsb.pl' && /\\/cas\\/login/i.test(href);
    }

    function setValue(input, value) {
      if (!input) return;
      input.focus();
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function stopTimer() {
      if (window.__comamdzisMeritoAutofillTimer) {
        clearInterval(window.__comamdzisMeritoAutofillTimer);
        window.__comamdzisMeritoAutofillTimer = null;
      }
    }

    function tryFillAndSubmit() {
      if (!isLoginPage()) {
        window.__comamdzisMeritoAutofillDone = false;
        stopTimer();
        return true;
      }
      if (window.__comamdzisMeritoAutofillDone) return true;

      var user = document.querySelector('#username, input[name="username"]');
      var pass = document.querySelector('#password, input[name="password"]');
      var form = document.querySelector('#fm1, form[action*="login"]');
      if (!user || !pass) return false;

      setValue(user, login);
      setValue(pass, password);
      window.__comamdzisMeritoAutofillDone = true;

      if (form) {
        setTimeout(function () {
          var submit = form.querySelector('button[type="submit"], input[type="submit"], button[name="submit"]');
          if (submit) submit.click();
          else form.submit();
        }, 350);
      }
      return true;
    }

    stopTimer();
    if (!isLoginPage()) {
      window.__comamdzisMeritoAutofillDone = false;
      return true;
    }

    var attempts = 0;
    window.__comamdzisMeritoAutofillTimer = setInterval(function () {
      attempts += 1;
      if (tryFillAndSubmit() || attempts >= 30) stopTimer();
    }, 400);
    tryFillAndSubmit();
    return true;
  })(); true;`;
}
