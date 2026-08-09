import * as FileSystem from 'expo-file-system/legacy';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { registerWszipWebViewLogin, registerWszipWebViewLoginCancel } from './wszipWebViewBridge';
import { createLoginCancelledError } from './loginCancellation.js';
import {
  extractPdfCandidatesFromHtml,
  parseWszipStudyInfoFromMoodleHtml,
  pickBestWszipPdfCandidate
} from './wszipPlanDiscoveryCore';
import {
  MOODLE_HOME_URL,
  MOODLE_LOGIN_URL,
  MOODLE_PROFILE_URL,
  WSZIP_WEBVIEW_LOGIN_TIMEOUT_MS,
  buildGoogleOAuthLoginScript,
  buildMoodleCaptureHtmlScript,
  buildMoodleFindPlansLinkScript,
  buildMoodleGoogleLoginClickScript,
  buildMoodleLoginProbeScript,
  buildMoodlePdfDownloadScript,
  buildNavigateScript,
  extractMoodleGoogleOAuthUrl,
  isGoogleAuthUrl,
  isMoodleHost,
  isMoodleLoggedInUrl,
  isMoodleLoginUrl,
  moodleWebViewUserAgent
} from './wszipWebViewLogin';

function safeFilename(value) {
  return String(value || 'wszip-plan.pdf').replace(/[^\w.-]+/g, '_');
}

async function savePdfBase64ToStorage(base64, filename) {
  const destination = `${FileSystem.documentDirectory}wszip-discovered-${safeFilename(filename)}`;
  await FileSystem.writeAsStringAsync(String(base64 || ''), destination, {
    encoding: 'base64'
  });
  const info = await FileSystem.getInfoAsync(destination);
  if (!info.exists) {
    throw new Error('Nie udało się zapisać pobranego planu PDF.');
  }
  return destination;
}

export function WszipWebViewLoginProvider({ children }) {
  const webViewRef = useRef(null);
  const resolverRef = useRef(null);
  const rejectRef = useRef(null);
  const timeoutRef = useRef(null);
  const loginRef = useRef(null);
  const pipelineRef = useRef('login');
  const profileRef = useRef(null);
  const htmlBuffersRef = useRef([]);
  const downloadStartedRef = useRef(false);
  const googleClickAttemptsRef = useRef(0);
  const oauthNavigateStartedRef = useRef(false);
  const autofillTimersRef = useRef([]);

  const [session, setSession] = useState(null);
  const [phase, setPhaseText] = useState('');
  const [currentUrl, setCurrentUrl] = useState('');

  const clearAutofillTimers = useCallback(() => {
    autofillTimersRef.current.forEach((timer) => clearTimeout(timer));
    autofillTimersRef.current = [];
  }, []);

  const clearTimeoutRef = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const finishError = useCallback(
    (error) => {
      clearTimeoutRef();
      clearAutofillTimers();
      const reject = rejectRef.current;
      resolverRef.current = null;
      rejectRef.current = null;
      loginRef.current = null;
      pipelineRef.current = 'login';
      profileRef.current = null;
      htmlBuffersRef.current = [];
      downloadStartedRef.current = false;
      googleClickAttemptsRef.current = 0;
      oauthNavigateStartedRef.current = false;
      setPhaseText('');
      setCurrentUrl('');
      setSession(null);
      reject?.(error instanceof Error ? error : new Error(String(error || 'Błąd logowania Moodle.')));
    },
    [clearAutofillTimers, clearTimeoutRef]
  );

  const finishSuccess = useCallback(
    (result) => {
      clearTimeoutRef();
      clearAutofillTimers();
      const resolve = resolverRef.current;
      resolverRef.current = null;
      rejectRef.current = null;
      loginRef.current = null;
      pipelineRef.current = 'login';
      htmlBuffersRef.current = [];
      downloadStartedRef.current = false;
      googleClickAttemptsRef.current = 0;
      oauthNavigateStartedRef.current = false;
      setPhaseText('');
      setCurrentUrl('');
      setSession(null);
      resolve?.(result);
    },
    [clearAutofillTimers, clearTimeoutRef]
  );

  const setPhase = useCallback((message) => {
    const value = String(message || '');
    setPhaseText(value);
    loginRef.current?.onPhase?.(value);
  }, []);

  const armTimeout = useCallback(
    (message) => {
      clearTimeoutRef();
      timeoutRef.current = setTimeout(() => {
        finishError(new Error(message));
      }, WSZIP_WEBVIEW_LOGIN_TIMEOUT_MS);
    },
    [clearTimeoutRef, finishError]
  );

  const scheduleGoogleAutofill = useCallback(() => {
    const pending = loginRef.current;
    if (!pending?.email || !pending?.password) return;
    clearAutofillTimers();
    const script = buildGoogleOAuthLoginScript(pending.email, pending.password);
    [400, 1200, 2500, 4500, 7000].forEach((delayMs) => {
      const timer = setTimeout(() => {
        webViewRef.current?.injectJavaScript(script);
      }, delayMs);
      autofillTimersRef.current.push(timer);
    });
    webViewRef.current?.injectJavaScript(script);
  }, [clearAutofillTimers]);

  const scheduleMoodleGoogleClick = useCallback(() => {
    setPhase('WSZiP: otwieram logowanie Google');
    webViewRef.current?.injectJavaScript(buildMoodleGoogleLoginClickScript());
    [1200, 3000, 6000, 10000].forEach((delayMs) => {
      const timer = setTimeout(() => {
        webViewRef.current?.injectJavaScript(buildMoodleGoogleLoginClickScript());
      }, delayMs);
      autofillTimersRef.current.push(timer);
    });
  }, [setPhase]);

  const navigateToGoogleOAuthFromHtml = useCallback((html) => {
    if (oauthNavigateStartedRef.current) return false;
    const oauthUrl = extractMoodleGoogleOAuthUrl(html);
    if (!oauthUrl) return false;
    oauthNavigateStartedRef.current = true;
    setPhase('WSZiP: przechodzę do logowania Google');
    webViewRef.current?.injectJavaScript(buildNavigateScript(oauthUrl));
    return true;
  }, [setPhase]);

  const tryPickPdfFromBuffers = useCallback(() => {
    const pending = loginRef.current;
    if (!pending || downloadStartedRef.current) return false;

    const profile = profileRef.current || parseWszipStudyInfoFromMoodleHtml('', pending.email);
    const candidates = [];
    for (const entry of htmlBuffersRef.current) {
      candidates.push(...extractPdfCandidatesFromHtml(entry.html, entry.url));
    }

    const best = pickBestWszipPdfCandidate(candidates, profile);
    if (!best) return false;

    downloadStartedRef.current = true;
    pipelineRef.current = 'download';
    setPhase(`WSZiP: pobieram ${best.filename}`);
    webViewRef.current?.injectJavaScript(buildMoodlePdfDownloadScript(best.url, best.filename));
    return true;
  }, [setPhase]);

  const startProfileCapture = useCallback(() => {
    if (pipelineRef.current !== 'login') return;
    pipelineRef.current = 'profile';
    setPhase('WSZiP: pobieram dane studenta');
    webViewRef.current?.injectJavaScript(buildNavigateScript(MOODLE_PROFILE_URL));
  }, [setPhase]);

  const startPlansDiscovery = useCallback(() => {
    if (pipelineRef.current === 'plans' || pipelineRef.current === 'download') return;
    pipelineRef.current = 'plans';
    setPhase('WSZiP: szukam planu PDF');
    webViewRef.current?.injectJavaScript(buildNavigateScript(MOODLE_HOME_URL));
  }, [setPhase]);

  const handleLoggedIn = useCallback(() => {
    if (pipelineRef.current !== 'login') return;
    clearAutofillTimers();
    setPhase('WSZiP: zalogowano — szukam planu');
    startProfileCapture();
  }, [clearAutofillTimers, setPhase, startProfileCapture]);

  const handleProfileHtml = useCallback(
    (html, url) => {
      const pending = loginRef.current;
      if (!pending) return;

      const parsed = parseWszipStudyInfoFromMoodleHtml(html, pending.email);
      profileRef.current = parsed;
      pending.onStudentProfile?.(parsed);
      htmlBuffersRef.current.push({ html, url });

      if (pipelineRef.current === 'profile') {
        startPlansDiscovery();
      }
    },
    [startPlansDiscovery]
  );

  const handlePlansHtml = useCallback(
    (html, url) => {
      htmlBuffersRef.current.push({ html, url });
      if (tryPickPdfFromBuffers()) return;
      setPhase('WSZiP: przechodzę do sekcji planów');
      webViewRef.current?.injectJavaScript(buildMoodleFindPlansLinkScript());
    },
    [setPhase, tryPickPdfFromBuffers]
  );

  const handleNavigationUrl = useCallback(
    (url) => {
      const pending = loginRef.current;
      if (!pending || !url) return;
      setCurrentUrl(String(url || ''));

      if (isGoogleAuthUrl(url)) {
        setPhase('WSZiP: loguję do Google');
        scheduleGoogleAutofill();
        return;
      }

      if (isMoodleLoggedInUrl(url) && pipelineRef.current === 'login') {
        handleLoggedIn();
      }
    },
    [handleLoggedIn, scheduleGoogleAutofill, setPhase]
  );

  const onMessage = useCallback(
    (event) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        const pending = loginRef.current;
        if (!pending) return;

        if (data?.type === 'wszip-moodle') {
          if (data.state === 'logged_in' && pipelineRef.current === 'login') {
            handleLoggedIn();
          }
          if (data.state === 'google_link_clicked') {
            oauthNavigateStartedRef.current = true;
            return;
          }
          if (data.state === 'google_link_pending') {
            return;
          }
          if (data.state === 'google_link_missing') {
            googleClickAttemptsRef.current += 1;
            if (googleClickAttemptsRef.current < 3) {
              scheduleMoodleGoogleClick();
              return;
            }
            finishError(new Error('Nie znaleziono przycisku Google na stronie logowania Moodle. Spróbuj ponownie za chwilę.'));
          }
          return;
        }

        if (data?.type === 'wszip-login-html') {
          if (pipelineRef.current === 'login') {
            navigateToGoogleOAuthFromHtml(String(data.html || ''));
          }
          return;
        }

        if (data?.type === 'wszip-google') {
          if (data.state === 'email_submitted') {
            setPhase('WSZiP: wysyłam e-mail Google');
          }
          if (data.state === 'password_submitted') {
            setPhase('WSZiP: wysyłam hasło Google');
          }
          if (data.state === 'waiting_for_user') {
            setPhase('WSZiP: dokończ logowanie Google na ekranie');
          }
          if (data.state === 'consent_clicked') {
            setPhase('WSZiP: potwierdzam zgodę Google');
          }
          return;
        }

        if (data?.type === 'wszip-html') {
          const html = String(data.html || '');
          const pageUrl = String(data.url || '');
          if (!html) return;

          if (pipelineRef.current === 'profile' || /user\/profile/i.test(pageUrl)) {
            handleProfileHtml(html, pageUrl);
            return;
          }

          if (pipelineRef.current === 'plans') {
            handlePlansHtml(html, pageUrl);
          }
          return;
        }

        if (data?.type === 'wszip-plans-link') {
          if (data.found && data.url) {
            setPhase(`WSZiP: otwieram ${data.label || 'plany zajęć'}`);
            pipelineRef.current = 'plans';
            webViewRef.current?.injectJavaScript(buildNavigateScript(data.url));
            return;
          }

          if (tryPickPdfFromBuffers()) return;

          finishError(new Error('Nie znaleziono planu PDF na Moodle. Dodaj plik ręcznie.'));
          return;
        }

        if (data?.type === 'wszip-pdf-download') {
          if (!data.ok) {
            finishError(new Error(data.error || 'Nie udało się pobrać planu PDF z Moodle.'));
            return;
          }

          void (async () => {
            try {
              const pdfUri = await savePdfBase64ToStorage(data.base64, data.filename);
              finishSuccess({
                pdfUri,
                studentProfile: profileRef.current,
                sourceUrl: data.url,
                filename: data.filename
              });
            } catch (error) {
              finishError(error);
            }
          })();
        }
      } catch {
        // ignore non-JSON messages
      }
    },
    [finishError, finishSuccess, handleLoggedIn, handlePlansHtml, handleProfileHtml, navigateToGoogleOAuthFromHtml, scheduleMoodleGoogleClick, setPhase, tryPickPdfFromBuffers]
  );

  const onLoadEnd = useCallback(
    (event) => {
      const pending = loginRef.current;
      if (!pending) return;

      const url = event?.nativeEvent?.url || session?.startUrl || '';
      handleNavigationUrl(url);

      if (isMoodleLoginUrl(url)) {
        scheduleMoodleGoogleClick();
        webViewRef.current?.injectJavaScript(buildMoodleLoginProbeScript());
        webViewRef.current?.injectJavaScript(buildMoodleCaptureHtmlScript('wszip-login-html'));
        return;
      }

      if (isGoogleAuthUrl(url)) {
        scheduleGoogleAutofill();
        return;
      }

      if (pipelineRef.current === 'profile' && /user\/profile/i.test(url)) {
        webViewRef.current?.injectJavaScript(buildMoodleCaptureHtmlScript('wszip-html'));
        return;
      }

      if (pipelineRef.current === 'plans' && isMoodleLoggedInUrl(url) && !isGoogleAuthUrl(url)) {
        webViewRef.current?.injectJavaScript(buildMoodleCaptureHtmlScript('wszip-html'));
      }
    },
    [handleNavigationUrl, scheduleGoogleAutofill, scheduleMoodleGoogleClick, session?.startUrl]
  );

  const runWebViewLogin = useCallback(
    ({ email, password, onPhase, onStudentProfile }) => {
      const loginEmail = String(email || '').trim();
      const loginPassword = String(password || '').trim();
      if (!loginEmail) {
        return Promise.reject(new Error('Wpisz uczelniany e-mail WSZiP.'));
      }
      if (!loginPassword) {
        return Promise.reject(new Error('Wpisz hasło do konta Google (uczelnia).'));
      }

      return new Promise((resolve, reject) => {
        clearTimeoutRef();
        clearAutofillTimers();
        resolverRef.current = resolve;
        rejectRef.current = reject;
        loginRef.current = { email: loginEmail, password: loginPassword, onPhase, onStudentProfile };
        pipelineRef.current = 'login';
        profileRef.current = null;
        htmlBuffersRef.current = [];
        downloadStartedRef.current = false;
        googleClickAttemptsRef.current = 0;
        oauthNavigateStartedRef.current = false;
        setPhaseText('WSZiP: logowanie do Moodle w tle');
        setCurrentUrl(MOODLE_LOGIN_URL);

        setSession({ startUrl: MOODLE_LOGIN_URL, email: loginEmail });
        onPhase?.('WSZiP: logowanie do Moodle w tle');
        armTimeout('Logowanie Moodle trwało za długo. Sprawdź e-mail i hasło Google.');
      });
    },
    [armTimeout, clearAutofillTimers, clearTimeoutRef]
  );

  useEffect(() => {
    registerWszipWebViewLogin(runWebViewLogin);
    registerWszipWebViewLoginCancel(() => {
      finishError(createLoginCancelledError('Przerwano logowanie WSZiP.'));
    });
    return () => {
      registerWszipWebViewLogin(null);
      registerWszipWebViewLoginCancel(null);
    };
  }, [finishError, runWebViewLogin]);

  const webViewSource = useMemo(() => {
    if (!session?.startUrl) return null;
    return { uri: session.startUrl };
  }, [session?.startUrl]);

  return (
    <>
      {children}
      {webViewSource ? (
        <View style={styles.overlay}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Logowanie WSZiP Moodle</Text>
              <Text style={styles.subtitle}>
                {phase || 'Otwieram Moodle. Jeśli Google poprosi o zgodę lub MFA, dokończ logowanie na tym ekranie.'}
              </Text>
              {currentUrl ? <Text style={styles.url}>{currentUrl}</Text> : null}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => finishError(new Error('Przerwano logowanie WSZiP.'))}
              style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
            >
              <Text style={styles.cancelButtonText}>Anuluj</Text>
            </Pressable>
          </View>
          <View style={styles.progressRow}>
            <ActivityIndicator color="#163b33" size="small" />
            <Text style={styles.progressText}>Po zalogowaniu aplikacja sama pobierze plan PDF z Moodle.</Text>
          </View>
          <WebView
            ref={webViewRef}
            domStorageEnabled
            injectedJavaScriptBeforeContentLoaded="window.__wszipGoogleLinkClicked=false;window.__wszipGoogleClickAttempts=0;window.__wszipGoogleClickTimer=null;window.__wszipGoogleEmailDone=false;window.__wszipGooglePasswordDone=false;window.__wszipGoogleConsentDone=false;true;"
            javaScriptEnabled
            onLoadEnd={onLoadEnd}
            onMessage={onMessage}
            onNavigationStateChange={(navState) => handleNavigationUrl(navState?.url)}
            onOpenWindow={(event) => {
              const targetUrl = event?.nativeEvent?.targetUrl;
              if (targetUrl) {
                webViewRef.current?.injectJavaScript(buildNavigateScript(targetUrl));
              }
            }}
            originWhitelist={['*']}
            setSupportMultipleWindows
            sharedCookiesEnabled
            source={webViewSource}
            style={styles.webView}
            thirdPartyCookiesEnabled
            userAgent={moodleWebViewUserAgent()}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: '#f5efe4',
    bottom: 0,
    elevation: 40,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 40
  },
  header: {
    alignItems: 'center',
    backgroundColor: '#f5efe4',
    borderBottomColor: 'rgba(22, 59, 51, 0.16)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 12,
    paddingHorizontal: 16,
    paddingTop: 18
  },
  headerText: {
    flex: 1
  },
  title: {
    color: '#163b33',
    fontFamily: 'Krub-Bold',
    fontSize: 16
  },
  subtitle: {
    color: '#314f46',
    fontFamily: 'Krub-Regular',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4
  },
  url: {
    color: '#6a776f',
    fontFamily: 'Krub-Regular',
    fontSize: 10,
    marginTop: 4
  },
  cancelButton: {
    backgroundColor: '#163b33',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  cancelButtonPressed: {
    opacity: 0.78
  },
  cancelButtonText: {
    color: '#fff7e8',
    fontFamily: 'Krub-Bold',
    fontSize: 12
  },
  progressRow: {
    alignItems: 'center',
    backgroundColor: '#fff7e8',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  progressText: {
    color: '#314f46',
    flex: 1,
    fontFamily: 'Krub-Regular',
    fontSize: 12
  },
  webView: {
    flex: 1
  }
});
