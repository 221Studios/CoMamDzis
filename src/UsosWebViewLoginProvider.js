import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { registerUsosWebViewLogin, registerUsosWebViewLoginCancel, registerUsosWebViewMfaWaiting } from './usosWebViewBridge.js';
import { createLoginCancelledError } from './loginCancellation.js';
import { looksLikeUsosIcalUrl } from './usosClient.js';
import {
  USOS_WEBVIEW_LOGIN_TIMEOUT_MS,
  buildAutofillScript,
  buildCasFailureProbeScript,
  buildCaptureProfilePageScript,
  buildExtractIcalFromDomScript,
  buildFetchUsosStudentProfileScript,
  buildNavigateScript,
  buildFetchIcalInWebViewScript,
  buildMfaStepScript,
  buildPortalHandshakeScript,
  buildUjAdfsLoginFlowScript,
  buildUjAdfsMfaScript,
  buildUmcsLoginFlowScript,
  getCollegeLoginStartUrl,
  getPlanExportPageUrl,
  getUsosGrupyPageUrl,
  getUsosGrupyZajeciowePageUrl,
  getUsosRankingPageUrl,
  isUjAdfsUrl,
  isUjPortal,
  isUmcsLoginHost,
  isSupportedUsosLoginPageUrl,
  isUsosExportPlanUrl,
  isUsosGrupyPageUrl,
  isUsosGrupyZajeciowePageUrl,
  isUsosHomeIndexUrl,
  isUsosRankingPageUrl,
  isUsosPortalHostUrl,
  isUsosPortalLoggedInUrl,
  isUsosPortalTicketCallbackUrl,
  isUsosSecondFactorUrl,
  usosWebViewUserAgent
} from './usosWebViewLogin.js';

const USOS_WEBVIEW_MFA_WAIT_MS = 300000;

function normalizeIcalUrl(value) {
  return String(value || '')
    .trim()
    .replace(/&amp;/g, '&')
    .replace(/^webcal:/i, 'https:');
}

export function UsosWebViewLoginProvider({ children }) {
  const webViewRef = useRef(null);
  const sessionRef = useRef(null);
  const resolverRef = useRef(null);
  const rejectRef = useRef(null);
  const timeoutRef = useRef(null);
  const submittedRef = useRef(false);
  const casFormSubmittedRef = useRef(false);
  const icalFetchStartedRef = useRef(false);
  const icalPipelineStepRef = useRef('');
  const profileCaptureRef = useRef({ homeHtml: '', grupyHtml: '', grupyZajecioweHtml: '', rankingHtml: '' });
  const profileOnlyRef = useRef(false);
  const grupyZajecioweCaptureAttemptsRef = useRef(0);
  const portalReachedRef = useRef(false);
  const loginRef = useRef(null);
  const mfaWaitingRef = useRef(false);
  const mfaProbeTimerRef = useRef(null);
  const mfaProbeTimersRef = useRef([]);
  const portalProbeTimerRef = useRef(null);
  const casProbeTimerRef = useRef(null);
  const casAutofillTimersRef = useRef([]);

  const [session, setSession] = useState(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const clearMfaProbeTimer = useCallback(() => {
    if (mfaProbeTimerRef.current) {
      clearTimeout(mfaProbeTimerRef.current);
      mfaProbeTimerRef.current = null;
    }
    mfaProbeTimersRef.current.forEach((timer) => clearTimeout(timer));
    mfaProbeTimersRef.current = [];
  }, []);

  const runMfaProbe = useCallback((mfaCode) => {
    const pending = loginRef.current;
    if (!pending) return;
    const url = pending.lastMfaUrl || '';
    if (isUjAdfsUrl(url)) {
      webViewRef.current?.injectJavaScript(
        buildUjAdfsLoginFlowScript(pending.login || '', pending.password || '', mfaCode || '')
      );
    } else {
      webViewRef.current?.injectJavaScript(
        buildMfaStepScript(mfaCode || '', url, pending.portalUrl || '')
      );
    }
  }, []);

  const scheduleMfaProbe = useCallback(
    (mfaCode, delayMs = 1200, options = {}) => {
      const { replace = true } = options;
      if (replace) clearMfaProbeTimer();
      const timer = setTimeout(() => runMfaProbe(mfaCode), delayMs);
      if (replace) {
        mfaProbeTimerRef.current = timer;
      } else {
        mfaProbeTimersRef.current.push(timer);
      }
    },
    [clearMfaProbeTimer, runMfaProbe]
  );

  const scheduleMfaRetries = useCallback(
    (mfaCode, delays = [800, 2000, 4500, 8000]) => {
      clearMfaProbeTimer();
      delays.forEach((delayMs) => scheduleMfaProbe(mfaCode, delayMs, { replace: false }));
    },
    [clearMfaProbeTimer, scheduleMfaProbe]
  );

  const clearPortalProbeTimer = useCallback(() => {
    if (portalProbeTimerRef.current) {
      clearTimeout(portalProbeTimerRef.current);
      portalProbeTimerRef.current = null;
    }
  }, []);

  const clearCasAutofillTimers = useCallback(() => {
    casAutofillTimersRef.current.forEach((timer) => clearTimeout(timer));
    casAutofillTimersRef.current = [];
  }, []);

  const clearCasProbeTimer = useCallback(() => {
    if (casProbeTimerRef.current) {
      clearTimeout(casProbeTimerRef.current);
      casProbeTimerRef.current = null;
    }
  }, []);

  const clearPending = useCallback(
    (options = {}) => {
      const { keepWebViewSession = false } = options;

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      clearMfaProbeTimer();
      clearPortalProbeTimer();
      clearCasProbeTimer();
      clearCasAutofillTimers();
      resolverRef.current = null;
      rejectRef.current = null;
      submittedRef.current = false;
      casFormSubmittedRef.current = false;
      icalFetchStartedRef.current = false;
      icalPipelineStepRef.current = '';
      profileCaptureRef.current = { homeHtml: '', grupyHtml: '', grupyZajecioweHtml: '', rankingHtml: '' };
      profileOnlyRef.current = false;
      grupyZajecioweCaptureAttemptsRef.current = 0;
      portalReachedRef.current = false;

      if (!keepWebViewSession) {
        loginRef.current = null;
        mfaWaitingRef.current = false;
        setSession(null);
      }
    },
    [clearCasAutofillTimers, clearCasProbeTimer, clearMfaProbeTimer, clearPortalProbeTimer]
  );

  const armTimeout = useCallback(
    (ms, messageBuilder) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        const error = new Error(messageBuilder());
        error.code = portalReachedRef.current ? 'USOS_ICAL_AFTER_WEBVIEW' : 'USOS_WEBVIEW_TIMEOUT';
        rejectRef.current?.(error);
        clearPending();
      }, ms);
    },
    [clearPending]
  );

  const finishSuccess = useCallback(
    (icalUrl) => {
      resolverRef.current?.(icalUrl);
      clearPending();
    },
    [clearPending]
  );

  const finishError = useCallback(
    (error) => {
      rejectRef.current?.(error);
      clearPending();
    },
    [clearPending]
  );

  const rejectSecondFactorRequired = useCallback(() => {
    const error = new Error(
      'USOS: wymagany jest kod z e-mail lub SMS. Wpisz go w polu poniżej i kliknij „Zaloguj” ponownie (kod ważny kilka minut).'
    );
    error.code = 'USOS_2FA_REQUIRED';
    if (loginRef.current) {
      loginRef.current.phase = 'waiting_code';
      loginRef.current.mfaCode = '';
    }
    mfaWaitingRef.current = true;
    rejectRef.current?.(error);
    resolverRef.current = null;
    rejectRef.current = null;
    armTimeout(
      USOS_WEBVIEW_MFA_WAIT_MS,
      () => 'USOS: minął czas na wpisanie kodu 2FA. Kliknij „Zaloguj” ponownie.'
    );
  }, [armTimeout]);

  const startProfileFetch = useCallback((portalUrl, onPhase) => {
    icalPipelineStepRef.current = 'profile_fetch';
    onPhase?.('USOS: pobieram Twoje dane i semestr z grup zajęciowych');
    webViewRef.current?.injectJavaScript(buildFetchUsosStudentProfileScript(portalUrl));
  }, []);

  const startIcalPipeline = useCallback((portalUrl, onPhase) => {
    if (icalFetchStartedRef.current) return;
    icalFetchStartedRef.current = true;
    profileCaptureRef.current = { homeHtml: '', grupyHtml: '', grupyZajecioweHtml: '', rankingHtml: '' };
    profileOnlyRef.current = Boolean(loginRef.current?.profileOnly);
    grupyZajecioweCaptureAttemptsRef.current = 0;
    if (loginRef.current) loginRef.current.phase = 'ical';
    if (profileOnlyRef.current) {
      onPhase?.('USOS: pobieram Twoje dane (strona główna, grupy dziekańskie, grupy zajęciowe)');
    } else {
      onPhase?.('USOS: plan zajęć → eksportuj (nawigacja w sesji przeglądarki)');
    }
    startProfileFetch(portalUrl, onPhase);
  }, [startProfileFetch]);

  const scheduleProfilePageCapture = useCallback((pageKey, delayMs = 500, renderDelayMs = 700) => {
    setTimeout(() => {
      webViewRef.current?.injectJavaScript(buildCaptureProfilePageScript(pageKey, renderDelayMs));
    }, delayMs);
  }, []);

  const continueIcalPipeline = useCallback(
    (url, portalUrl, onPhase) => {
      if (!icalFetchStartedRef.current || loginRef.current?.phase !== 'ical') return;

      const step = icalPipelineStepRef.current;
      if (step === 'home' && isUsosHomeIndexUrl(url, portalUrl)) {
        icalPipelineStepRef.current = 'home_capture';
        onPhase?.('USOS: zapisuję dane ze strony głównej');
        scheduleProfilePageCapture('home');
        return;
      }

      if (step === 'grupy' && isUsosGrupyPageUrl(url)) {
        icalPipelineStepRef.current = 'grupy_capture';
        onPhase?.('USOS: pobieram grupy i program studiów');
        scheduleProfilePageCapture('grupy');
        return;
      }

      if (
        (step === 'grupyZajeciowe' || step === 'grupy_capture')
        && isUsosGrupyZajeciowePageUrl(url)
      ) {
        icalPipelineStepRef.current = 'grupy_zajeciowe_capture';
        onPhase?.('USOS: pobieram semestr z grup zajęciowych');
        scheduleProfilePageCapture('grupyZajeciowe', 500, 1400);
        return;
      }

      if (!profileOnlyRef.current && (step === 'export' || step === 'profile_fetch') && isUsosExportPlanUrl(url)) {
        icalPipelineStepRef.current = 'extract';
        onPhase?.('USOS: wyciągam link iCal z modala');
        setTimeout(() => {
          webViewRef.current?.injectJavaScript(buildExtractIcalFromDomScript());
        }, 500);
      }
    },
    [scheduleProfilePageCapture]
  );


  const injectMfaScript = useCallback((mfaCode, url, portalUrl = '', credentials = {}) => {
    if (isUjAdfsUrl(url) || isUjPortal(portalUrl)) {
      if (isUjAdfsUrl(url) && (credentials.login || credentials.password)) {
        webViewRef.current?.injectJavaScript(
          buildUjAdfsLoginFlowScript(credentials.login || '', credentials.password || '', mfaCode || '')
        );
      } else {
        webViewRef.current?.injectJavaScript(buildUjAdfsMfaScript(mfaCode || ''));
      }
    } else {
      webViewRef.current?.injectJavaScript(buildMfaStepScript(mfaCode || '', url, portalUrl));
    }
  }, []);

  const schedulePortalHandshake = useCallback(
    (portalUrl, delayMs = 800) => {
      clearPortalProbeTimer();
      portalProbeTimerRef.current = setTimeout(() => {
        if (!loginRef.current || icalFetchStartedRef.current) return;
        webViewRef.current?.injectJavaScript(buildPortalHandshakeScript(portalUrl));
      }, delayMs);
    },
    [clearPortalProbeTimer]
  );

  const scheduleCasFailureProbe = useCallback(
    (delayMs = 2500) => {
      clearCasProbeTimer();
      casProbeTimerRef.current = setTimeout(() => {
        if (!loginRef.current || portalReachedRef.current) return;
        webViewRef.current?.injectJavaScript(buildCasFailureProbeScript());
      }, delayMs);
    },
    [clearCasProbeTimer]
  );

  const injectCasAutofill = useCallback((login, password, url, mfaCode = '') => {
    webViewRef.current?.injectJavaScript(buildAutofillScript(login, password, url, mfaCode));
  }, []);

  const scheduleCasAutofill = useCallback(
    (login, password, url, mfaCode = '', onPhase) => {
      if (!loginRef.current || portalReachedRef.current) return;
      if (isUjAdfsUrl(url)) {
        injectMfaScript(mfaCode, url, loginRef.current.portalUrl, { login, password });
        return;
      }
      onPhase?.(
        mfaCode ? 'USOS: wysyłam kod weryfikacyjny (UMCS)' : 'USOS: wypełniam login i hasło'
      );
      injectCasAutofill(login, password, url, mfaCode);
      clearCasAutofillTimers();
      [900, 2200, 4500].forEach((delayMs) => {
        const timer = setTimeout(() => {
          if (!loginRef.current || portalReachedRef.current || casFormSubmittedRef.current) return;
          injectCasAutofill(login, password, url, mfaCode);
        }, delayMs);
        casAutofillTimersRef.current.push(timer);
      });
      if (!isUmcsLoginHost(url)) scheduleCasFailureProbe();
    },
    [clearCasAutofillTimers, injectCasAutofill, injectMfaScript, scheduleCasFailureProbe]
  );

  const handleMfaPage = useCallback(
    (url, onPhase) => {
      const pending = loginRef.current;
      if (!pending) return;

      pending.lastMfaUrl = url;
      const mfaCode = String(pending.mfaCode || '').trim();

      if (mfaCode || pending.phase === 'sms_sent' || pending.phase === 'submit_code') {
        onPhase?.(
          mfaCode
            ? 'USOS: wpisuję kod weryfikacyjny w przeglądarce'
            : 'USOS: czekam na pole kodu SMS w przeglądarce'
        );
        injectMfaScript(mfaCode, url, pending.portalUrl, {
          login: pending.login,
          password: pending.password
        });
        if (mfaCode) scheduleMfaRetries(mfaCode, [600, 1500, 3000, 5500, 9000, 14000]);
        return;
      }

      if (pending.phase !== 'sms_sent') {
        pending.phase = 'sms_select';
        onPhase?.('USOS: wybieram metodę SMS/telefon w przeglądarce');
        injectMfaScript('', url, pending.portalUrl, {
          login: pending.login,
          password: pending.password
        });
        scheduleMfaProbe('', 1500);
        scheduleMfaProbe('', 3500);
      }
    },
    [injectMfaScript, scheduleMfaProbe, scheduleMfaRetries]
  );

  const handleNavigationUrl = useCallback(
    (url) => {
      const pending = loginRef.current;
      if (!pending || !url) return;

      const { login, password, portalUrl, onPhase } = pending;

      if (isUjAdfsUrl(url)) pending.lastMfaUrl = url;

      if (isUsosSecondFactorUrl(url)) {
        handleMfaPage(url, onPhase);
        return;
      }

      if (isSupportedUsosLoginPageUrl(url)) {
        if (isUmcsLoginHost(url)) pending.lastMfaUrl = url;
        const isUmcs = isUmcsLoginHost(url);
        const shouldRunCasStep = isUmcs
          || (!casFormSubmittedRef.current && pending.phase !== 'waiting_code')
          || pending.mfaCode;
        if (shouldRunCasStep) {
          if (!submittedRef.current) submittedRef.current = true;
          scheduleCasAutofill(login, password, url, pending.mfaCode || '', onPhase);
        }
        return;
      }

      if (isUsosPortalHostUrl(url, portalUrl)) {
        if (isUsosPortalTicketCallbackUrl(url)) {
          onPhase?.('USOS: przekazuję ticket CAS do USOSweb');
          schedulePortalHandshake(portalUrl, 400);
          return;
        }
        if (isUsosPortalLoggedInUrl(url, portalUrl)) {
          portalReachedRef.current = true;
          mfaWaitingRef.current = false;
          onPhase?.(
            pending.profileOnly
              ? 'USOS: sesja USOSweb — pobieram Twoje dane'
              : 'USOS: sesja USOSweb — pobieram link iCal'
          );
          startIcalPipeline(portalUrl, onPhase);
          return;
        }
        if (submittedRef.current) {
          onPhase?.('USOS: przekazuję sesję do USOSweb');
          schedulePortalHandshake(portalUrl);
        }
      }
    },
    [handleMfaPage, scheduleCasAutofill, schedulePortalHandshake, startIcalPipeline]
  );

  const applyWebViewStudentProfile = useCallback(async (payload, portalUrl, login) => {
    const pending = loginRef.current;
    if (!pending?.onStudentProfile) return;
    const capture = profileCaptureRef.current;
    const homeHtml = payload?.homeHtml || capture.homeHtml || '';
    const grupyHtml = payload?.grupyHtml || capture.grupyHtml || '';
    const grupyZajecioweHtml = payload?.grupyZajecioweHtml || capture.grupyZajecioweHtml || '';
    if (!homeHtml && !grupyHtml && !grupyZajecioweHtml) return;
    try {
      const { buildUsosStudentProfileFromHtml, deriveUsosSemesterLabel, isUsosSemesterValueValid } =
        await import('./usosStudentProfile.js');
      let profile = buildUsosStudentProfileFromHtml({
        homeHtml,
        grupyHtml,
        grupyZajecioweHtml,
        portalUrl,
        login: login || pending.login
      });
      if (!isUsosSemesterValueValid(profile?.semester)) {
        const semester = deriveUsosSemesterLabel({ homeHtml, grupyZajecioweHtml });
        if (isUsosSemesterValueValid(semester)) {
          profile = { ...profile, semester };
        }
      }
      await pending.onStudentProfile(profile);
    } catch {
      // profil opcjonalny
    }
  }, []);

  const applyCapturedProfile = useCallback(async () => {
    const pending = loginRef.current;
    if (!pending) return;
    await applyWebViewStudentProfile({}, pending.portalUrl, pending.login);
  }, [applyWebViewStudentProfile]);

  const waitForProfileCapture = useCallback((maxMs = 9000) => {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const tick = () => {
        const capture = profileCaptureRef.current;
        const hasBasics = Boolean(capture.homeHtml && capture.grupyHtml);
        const hasGrupyZajeciowe = Boolean(capture.grupyZajecioweHtml || capture.homeHtml);
        const timedOut = Date.now() - startedAt >= maxMs;
        if ((hasBasics && hasGrupyZajeciowe) || timedOut) {
          resolve(capture);
          return;
        }
        setTimeout(tick, 150);
      };
      tick();
    });
  }, []);

  const finishProfileOnlySuccess = useCallback(() => {
    void waitForProfileCapture().then((capture) =>
      applyWebViewStudentProfile(capture, loginRef.current?.portalUrl, loginRef.current?.login).finally(() =>
        finishSuccess('')
      )
    );
  }, [applyWebViewStudentProfile, finishSuccess, waitForProfileCapture]);

  const handleProfileFetchResult = useCallback(
    async (data, pending) => {
      profileCaptureRef.current = {
        homeHtml: data.homeHtml || '',
        grupyHtml: data.grupyHtml || '',
        grupyZajecioweHtml: data.grupyZajecioweHtml || '',
        rankingHtml: data.rankingHtml || ''
      };

      let grupyZajecioweOk = false;
      try {
        const { parseUsosGrupyZajeciowe, deriveUsosSemesterLabel, isUsosSemesterValueValid } =
          await import('./usosStudentProfile.js');
        const parsed = parseUsosGrupyZajeciowe(profileCaptureRef.current.grupyZajecioweHtml)
          || parseUsosGrupyZajeciowe(profileCaptureRef.current.homeHtml);
        grupyZajecioweOk = Boolean(parsed?.term || parsed?.semNumber || parsed?.semester)
          || isUsosSemesterValueValid(
            deriveUsosSemesterLabel({
              homeHtml: profileCaptureRef.current.homeHtml,
              grupyZajecioweHtml: profileCaptureRef.current.grupyZajecioweHtml
            })
          );
      } catch {
        // parser opcjonalny
      }

      if (!grupyZajecioweOk && grupyZajecioweCaptureAttemptsRef.current < 1) {
        grupyZajecioweCaptureAttemptsRef.current += 1;
        pending.onPhase?.('USOS: uzupełniam semestr w tle');
      }

      await applyWebViewStudentProfile(profileCaptureRef.current, pending.portalUrl, pending.login);

      if (profileOnlyRef.current) {
        finishSuccess('');
        return;
      }

      if (icalPipelineStepRef.current === 'profile_fetch') {
        icalPipelineStepRef.current = 'export';
        pending.onPhase?.('USOS: otwieram eksport planu (jak „eksportuj →”)');
        setTimeout(() => {
          webViewRef.current?.injectJavaScript(
            buildNavigateScript(getPlanExportPageUrl(pending.portalUrl))
          );
        }, 300);
      }
    },
    [applyWebViewStudentProfile, finishSuccess, startProfileFetch]
  );

  const runWebViewLogin = useCallback(
    ({ login, mfaCode = '', password, portalUrl, onPhase, onStudentProfile, profileOnly = false }) => {
      const trimmedCode = String(mfaCode || '').trim();

      if (trimmedCode && mfaWaitingRef.current && sessionRef.current) {
        onPhase?.('USOS: wysyłam kod weryfikacyjny (2FA)');

        return new Promise((resolve, reject) => {
          resolverRef.current = resolve;
          rejectRef.current = reject;
          const pending = loginRef.current;
          pending.mfaCode = trimmedCode;
          pending.phase = 'submit_code';
          pending.onPhase = onPhase;
          pending.onStudentProfile = onStudentProfile;

          armTimeout(USOS_WEBVIEW_LOGIN_TIMEOUT_MS, () =>
            profileOnlyRef.current
              ? 'USOS: nie udało się pobrać danych studenta z USOSweb.'
              : portalReachedRef.current
                ? 'USOS: zalogowano, ale nie udało się odczytać linku iCal. Użyj „Dodaj link iCal”.'
                : 'USOS: logowanie przez przeglądarkę trwało za długo.'
          );

          const resumeUrl = pending.lastMfaUrl || sessionRef.current?.startUrl || '';
          const isUmcs = isUmcsLoginHost(resumeUrl) || isUmcsLoginHost(pending.portalUrl);
          if (isUmcs) {
            webViewRef.current?.injectJavaScript(
              buildUmcsLoginFlowScript(pending.login, pending.password, trimmedCode)
            );
          } else {
            injectMfaScript(trimmedCode, resumeUrl, pending.portalUrl, {
              login: pending.login,
              password: pending.password
            });
            scheduleMfaRetries(trimmedCode);
          }
        });
      }

      const startUrl = getCollegeLoginStartUrl(portalUrl);
      onPhase?.('USOS: logowanie w ukrytej przeglądarce (CAS → USOSweb)');

      return new Promise((resolve, reject) => {
        clearPending();
        mfaWaitingRef.current = false;
        resolverRef.current = resolve;
        rejectRef.current = reject;
        loginRef.current = {
          login,
          password,
          portalUrl,
          onPhase,
          onStudentProfile,
          profileOnly,
          mfaCode: trimmedCode,
          phase: trimmedCode ? 'submit_code' : 'login',
          lastMfaUrl: ''
        };
        profileOnlyRef.current = profileOnly;
        submittedRef.current = false;
        casFormSubmittedRef.current = false;
        icalFetchStartedRef.current = false;
        portalReachedRef.current = false;

        setSession({ startUrl, portalUrl });

        armTimeout(USOS_WEBVIEW_LOGIN_TIMEOUT_MS, () =>
          profileOnly
            ? 'USOS: nie udało się pobrać danych studenta z USOSweb.'
            : portalReachedRef.current
              ? 'USOS: zalogowano, ale nie udało się odczytać linku iCal. Użyj „Dodaj link iCal”.'
              : 'USOS: logowanie przez przeglądarkę trwało za długo. Spróbuj ponownie lub wklej link iCal ręcznie.'
        );
      });
    },
    [armTimeout, clearPending, injectMfaScript, scheduleMfaRetries]
  );

  const cancelWebViewLogin = useCallback(() => {
    finishError(createLoginCancelledError('Przerwano logowanie USOS.'));
  }, [finishError]);

  useEffect(() => {
    registerUsosWebViewLogin(runWebViewLogin);
    registerUsosWebViewLoginCancel(cancelWebViewLogin);
    registerUsosWebViewMfaWaiting(() => mfaWaitingRef.current && Boolean(sessionRef.current));
    return () => {
      registerUsosWebViewLogin(null);
      registerUsosWebViewLoginCancel(null);
      registerUsosWebViewMfaWaiting(null);
    };
  }, [cancelWebViewLogin, runWebViewLogin]);

  const onMessage = useCallback(
    (event) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        const pending = loginRef.current;
        if (!pending) return;

        if (data?.type === 'usos-cas' && data.state === 'auth_failed') {
          finishError(
            new Error(
              'USOS: system logowania uczelni odrzucił login lub hasło. Sprawdź pełny e-mail i hasło.'
            )
          );
          return;
        }

        if (data?.type === 'usos-cas' && data.state === 'form_submitted') {
          casFormSubmittedRef.current = true;
          clearCasAutofillTimers();
          pending.onPhase?.('USOS: wysyłam login i hasło do systemu uczelni');
          return;
        }

        if (data?.type === 'usos-cas' && data.state === 'username_submitted') {
          pending.onPhase?.('USOS: wysyłam login do systemu uczelni');
          return;
        }

        if (data?.type === 'usos-cas' && data.state === 'form_missing') {
          if (isUjAdfsUrl(pending.lastMfaUrl) || pending.phase === 'sms_select' || pending.phase === 'sms_sent') {
            return;
          }
          const error = new Error(
            'USOS: nie udało się wypełnić formularza logowania w przeglądarce. Spróbuj ponownie.'
          );
          error.code = 'USOS_WEBVIEW_TIMEOUT';
          finishError(error);
          return;
        }

        if (data?.type === 'usos-portal') {
          if (data.state === 'logged_in') {
            portalReachedRef.current = true;
            mfaWaitingRef.current = false;
            pending.onPhase?.(
              pending.profileOnly
                ? 'USOS: sesja USOSweb — pobieram Twoje dane'
                : 'USOS: sesja USOSweb — pobieram link iCal'
            );
            startIcalPipeline(pending.portalUrl, pending.onPhase);
            return;
          }
          if (data.state === 'auto_post_submitted' || data.state === 'navigating_home') {
            schedulePortalHandshake(pending.portalUrl, 1500);
          }
          return;
        }

        if (data?.type === 'usos-mfa') {
          if (data.state === 'needs_code') {
            if (pending.phase === 'sms_select') {
              scheduleMfaProbe('', 1200);
              scheduleMfaProbe('', 3000);
              return;
            }
            rejectSecondFactorRequired();
            return;
          }
          if (data.state === 'sms_selected') {
            pending.phase = 'sms_sent';
            const code = String(pending.mfaCode || '').trim();
            if (code) {
              pending.onPhase?.('USOS: wysyłam kod SMS/2FA w przeglądarce');
              scheduleMfaRetries(code);
            } else {
              pending.onPhase?.('USOS: wysłano/wybrano SMS — wpisz kod w polu poniżej');
              rejectSecondFactorRequired();
            }
            return;
          }
          if (data.state === 'form_revealed' || data.state === 'waiting_code_input') {
            const code = String(pending.mfaCode || '').trim();
            if (code) scheduleMfaRetries(code);
            return;
          }
          if (data.state === 'code_submitted') {
            pending.phase = 'code_sent';
            pending.onPhase?.('USOS: kod wysłany — kończę logowanie do USOSweb');
            const code = String(pending.mfaCode || '').trim();
            if (code && data.submitClicked === false) {
              scheduleMfaRetries(code, [1200, 2800, 5000, 8500]);
            }
          }
          if (data.state === 'mfa_failed') {
            finishError(
              new Error(
                'USOS: kod SMS/e-mail został odrzucony lub wygasł. Spróbuj ponownie z nowym kodem.'
              )
            );
          }
          return;
        }

        if (data?.type === 'usos-profile-fetch') {
          void handleProfileFetchResult(data, pending);
          return;
        }

        if (data?.type === 'usos-profile-page') {
          const page = String(data.page || '');
          if (page === 'home' && data.html) {
            profileCaptureRef.current.homeHtml = data.html;
            if (icalPipelineStepRef.current === 'home_capture') {
              icalPipelineStepRef.current = 'grupy';
              setTimeout(() => {
                webViewRef.current?.injectJavaScript(
                  buildNavigateScript(getUsosGrupyPageUrl(pending.portalUrl))
                );
              }, 250);
            }
          }
          if (page === 'grupy' && data.html) {
            profileCaptureRef.current.grupyHtml = data.html;
            if (icalPipelineStepRef.current === 'grupy_capture') {
              icalPipelineStepRef.current = 'grupyZajeciowe';
              pending.onPhase?.('USOS: pobieram semestr z grup zajęciowych');
              setTimeout(() => {
                webViewRef.current?.injectJavaScript(
                  buildNavigateScript(getUsosGrupyZajeciowePageUrl(pending.portalUrl))
                );
              }, 250);
            }
          }
          if (page === 'grupyZajeciowe' && data.html) {
            profileCaptureRef.current.grupyZajecioweHtml = data.html;
            void (async () => {
              let grupyZajecioweParsed = false;
              try {
                const { parseUsosGrupyZajeciowe } = await import('./usosStudentProfile.js');
                const parsed = parseUsosGrupyZajeciowe(data.html);
                grupyZajecioweParsed = Boolean(parsed?.term || parsed?.semNumber || parsed?.semester);
              } catch {
                // parser opcjonalny
              }
              if (!grupyZajecioweParsed && grupyZajecioweCaptureAttemptsRef.current < 1) {
                grupyZajecioweCaptureAttemptsRef.current += 1;
                pending.onPhase?.('USOS: ponawiam odczyt semestru z grup zajęciowych');
                webViewRef.current?.injectJavaScript(
                  "window.__usosProfileCaptureSent=window.__usosProfileCaptureSent||{};delete window.__usosProfileCaptureSent['grupyZajeciowe'];true;"
                );
                scheduleProfilePageCapture('grupyZajeciowe', 400, 1800);
                return;
              }
              await applyCapturedProfile();
              if (profileOnlyRef.current && icalPipelineStepRef.current === 'grupy_zajeciowe_capture') {
                finishProfileOnlySuccess();
                return;
              }
              if (icalPipelineStepRef.current === 'grupy_zajeciowe_capture') {
                icalPipelineStepRef.current = 'export';
                pending.onPhase?.('USOS: otwieram eksport planu (jak „eksportuj →”)');
                setTimeout(() => {
                  webViewRef.current?.injectJavaScript(
                    buildNavigateScript(getPlanExportPageUrl(pending.portalUrl))
                  );
                }, 250);
              }
            })();
          }
          return;
        }

        if (data?.type !== 'usos-ical') return;

        const url = normalizeIcalUrl(data.url);
        if (url && looksLikeUsosIcalUrl(url)) {
          void waitForProfileCapture().then((capture) =>
            applyWebViewStudentProfile(capture, pending?.portalUrl, pending?.login).finally(() =>
              finishSuccess(url)
            )
          );
          return;
        }

        const error = new Error(
          'USOS: zalogowano w przeglądarce, ale nie znaleziono linku iCal.'
            + (data.error ? ` (${data.error})` : '')
            + ' Wejdź w Plan zajęć → eksportuj i wklej odnośnik ręcznie.'
        );
        error.code = 'USOS_ICAL_AFTER_WEBVIEW';
        finishError(error);
      } catch {
        // ignore non-JSON messages
      }
    },
    [applyCapturedProfile, applyWebViewStudentProfile, clearCasAutofillTimers, finishError, finishProfileOnlySuccess, finishSuccess, handleProfileFetchResult, rejectSecondFactorRequired, scheduleMfaProbe, scheduleMfaRetries, schedulePortalHandshake, scheduleProfilePageCapture, startIcalPipeline, waitForProfileCapture]
  );

  const onNavigationStateChange = useCallback(
    (navState) => {
      if (!navState?.url) return;
      handleNavigationUrl(navState.url);
    },
    [handleNavigationUrl]
  );

  const onLoadEnd = useCallback(
    (event) => {
      const pending = loginRef.current;
      if (!pending) return;

      const url = event?.nativeEvent?.url || session?.startUrl || '';
      if (isUmcsLoginHost(url)) pending.lastMfaUrl = url;
      if (isUjAdfsUrl(url)) pending.lastMfaUrl = url;
      if (isUsosSecondFactorUrl(url)) {
        handleMfaPage(url, pending.onPhase);
        return;
      }

      if (
        isSupportedUsosLoginPageUrl(url)
        && (pending.phase === 'login' || pending.phase === 'submit_code' || isUmcsLoginHost(url))
      ) {
        if (!casFormSubmittedRef.current || isUmcsLoginHost(url)) {
          if (!submittedRef.current) submittedRef.current = true;
          scheduleCasAutofill(
            pending.login,
            pending.password,
            url || session?.startUrl || '',
            pending.mfaCode || '',
            pending.onPhase
          );
        }
        return;
      }

      if (isUsosPortalHostUrl(url, pending.portalUrl) && pending.phase === 'ical') {
        continueIcalPipeline(url, pending.portalUrl, pending.onPhase);
        return;
      }

      if (isUsosPortalHostUrl(url, pending.portalUrl) && submittedRef.current && !icalFetchStartedRef.current) {
        schedulePortalHandshake(pending.portalUrl);
      }
    },
    [continueIcalPipeline, handleMfaPage, scheduleCasAutofill, schedulePortalHandshake, session?.startUrl]
  );

  const webViewSource = useMemo(() => {
    if (!session?.startUrl) return null;
    return { uri: session.startUrl };
  }, [session?.startUrl]);

  return (
    <>
      {children}
      {webViewSource ? (
        <View pointerEvents="none" style={styles.hidden}>
          <WebView
            ref={webViewRef}
            domStorageEnabled
            injectedJavaScriptBeforeContentLoaded="window.__usosCasSubmitDone=false;window.__usosCasAutofillTimer=null;window.__usosAdfsSubmitDone=false;window.__usosIcalFetchStarted=false;window.__usosProfileFetchStarted=false;window.__usosMfaBusy=false;window.__usosUjMfaBusy=false;window.__usosPortalHandshakeBusy=false;window.__usosHomeNavDone=false;window.__usosUmcsFlowBusy=false;window.__usosUmcsProviderSelected=false;window.__usosUmcsChannelSelected=false;window.__usosProfileCaptureSent={};true;"
            javaScriptEnabled
            onLoadEnd={onLoadEnd}
            onMessage={onMessage}
            onNavigationStateChange={onNavigationStateChange}
            originWhitelist={['*']}
            sharedCookiesEnabled
            source={webViewSource}
            thirdPartyCookiesEnabled
            userAgent={usosWebViewUserAgent()}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  hidden: {
    height: 1,
    left: -1000,
    opacity: 0,
    overflow: 'hidden',
    position: 'absolute',
    top: -1000,
    width: 1
  }
});
