export function isPollubPortalUrl(url) {
  return /ehms\.pollub\.pl/i.test(String(url || ''));
}

export function buildPollubPortalAutofillScript(login, password) {
  const loginJson = JSON.stringify(String(login || '').trim());
  const passJson = JSON.stringify(String(password || ''));

  return `(function () {
    var login = ${loginJson};
    var password = ${passJson};

    function isLoginPage() {
      return Boolean(
        document.querySelector('input[name^="login_"]')
        && document.querySelector('input[name^="pass_"]')
      );
    }

    function isLoggedIn() {
      var source = String(document.body && document.body.innerText || '');
      return /wyloguj/i.test(source) || /MOJE STUDIA/i.test(source);
    }

    function setValue(input, value) {
      if (!input) return;
      var descriptor = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(input, value);
      } else {
        input.value = value;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function stopTimer() {
      if (window.__comamdzisPollubAutofillTimer) {
        clearInterval(window.__comamdzisPollubAutofillTimer);
        window.__comamdzisPollubAutofillTimer = null;
      }
    }

    function tryFillAndSubmit() {
      if (isLoggedIn()) {
        window.__comamdzisPollubAutofillDone = true;
        stopTimer();
        return true;
      }
      if (!isLoginPage()) {
        window.__comamdzisPollubAutofillDone = false;
        return false;
      }
      if (window.__comamdzisPollubAutofillDone) return true;

      var loginInput = document.querySelector('input[name^="login_"]');
      var passInput = document.querySelector('input[name^="pass_"]');
      var form = document.querySelector('form');
      if (!loginInput || !passInput || !form) return false;

      setValue(loginInput, login);
      setValue(passInput, password);
      window.__comamdzisPollubAutofillDone = true;

      setTimeout(function () {
        var submit = form.querySelector('button[type="submit"], input[type="submit"], button');
        if (submit && !submit.disabled) submit.click();
        else form.submit();
      }, 350);
      return true;
    }

    stopTimer();
    if (isLoggedIn()) return true;

    var attempts = 0;
    window.__comamdzisPollubAutofillTimer = setInterval(function () {
      attempts += 1;
      if (tryFillAndSubmit() || attempts >= 40) stopTimer();
    }, 400);
    tryFillAndSubmit();
    return true;
  })(); true;`;
}
