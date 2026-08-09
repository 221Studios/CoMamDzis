import { loginAndFetchSchedule as loginAndFetchPollubSchedule, loginToPollub, unpackPollubStoredCredential } from './pollubClient';
import { studentProfileFromLogin, studentProfileFromPollub, studentProfileFromWat, readStudentProfile } from './studentProfile';
import { unpackWszipPdfCredential, unpackWszipStoredCredential } from './wszipClient';
import { serializeCookieJar } from './portalSession';
import { loginAndFetchSchedule as loginAndFetchCdvSchedule, loginToWu } from './wuClient';
import { loginAndFetchSchedule as loginAndFetchMeritoSchedule, loginToMerito } from './meritoClient';
import {
  loginAndFetchSchedule as loginAndFetchUsosSchedule,
  packUsosStoredCredential,
  tryQuickUsosSemesterFromCookies,
  tryQuickUsosProfileFromCookies,
  unpackUsosStoredCredential,
  usosProfileSnapshotFromStored
} from './usosClient';
import { loginToUsosAndFetchIcal } from './usosClient';
import { loginAndFetchSchedule as loginAndFetchWszipSchedule } from './wszipClient';
import { loginAndFetchSchedule as loginAndFetchWatSchedule } from './watClient';
import { loginAndFetchSchedule as loginAndFetchWseitSchedule, loginToWseit, unpackWseitStoredCredential } from './wseitClient';
import { portalUrlForLogin, SCHOOL_CDV, SCHOOL_MERITO, SCHOOL_POLLUB, SCHOOL_USOS, SCHOOL_WAT, SCHOOL_WSEIT, SCHOOL_WSZIP } from './schoolConfig';
import { shouldRefreshUsosStudentProfile } from './usosStudentProfile';

const LOGIN_TIMEOUT_MS = 60000;
const USOS_LOGIN_TIMEOUT_MS = 120000;
const SCHEDULE_TIMEOUT_MS = 180000;

function withTimeout(operation, getPhase, timeoutMs, timeoutMessage) {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const phase = getPhase?.();
      reject(new Error(`${phase ? `Utknięto na etapie: ${phase}. ` : ''}${timeoutMessage}`));
    }, timeoutMs);
  });

  return Promise.race([operation, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function withScheduleTimeout(operation, getPhase) {
  return withTimeout(operation, getPhase, SCHEDULE_TIMEOUT_MS, 'Pobieranie planu trwa za dlugo. Sprawdz internet i sprobuj ponownie.');
}

function withLoginTimeout(operation, getPhase) {
  return withTimeout(operation, getPhase, LOGIN_TIMEOUT_MS, 'Logowanie trwa za dlugo. Sprawdz internet i sprobuj ponownie.');
}

export function normalizeScheduleFetchResult(result) {
  if (Array.isArray(result)) {
    return {
      events: result,
      enrichDetails: null,
      portalCookies: null
    };
  }

  return {
    events: result?.events || [],
    enrichDetails: result?.enrichDetails || null,
    portalCookies: result?.portalCookies || null,
    discoveredPollubPdfUris: result?.discoveredPollubPdfUris || []
  };
}

export async function loginOnly({ school, email, password, onPhase }) {
  let currentPhase = '';
  const setPhase = (message) => {
    currentPhase = message;
    onPhase?.(message);
  };

  if (school === SCHOOL_MERITO) {
    setPhase('Merito: loguję do konta');
    const session = await withLoginTimeout(loginToMerito(email, password, setPhase), () => currentPhase);
    return {
      school: SCHOOL_MERITO,
      cookies: session.cookies || []
    };
  }

  if (school === SCHOOL_CDV) {
    setPhase('CDV: loguję do Wirtualnej Uczelni');
    const jar = await withTimeout(
      loginToWu(email, password, setPhase),
      () => currentPhase,
      90000,
      'Logowanie trwa za dlugo. Sprawdz internet i sprobuj ponownie.'
    );
    return {
      school: SCHOOL_CDV,
      cookies: serializeCookieJar(jar)
    };
  }

  if (school === SCHOOL_USOS) {
    setPhase('USOS: loguję do USOSweb');
    const stored = unpackUsosStoredCredential(password);
    const icalUrl = await withTimeout(
      loginToUsosAndFetchIcal({
        login: email,
        password: stored?.password || password,
        portalUrl: portalUrlForLogin(email),
        onPhase: setPhase
      }),
      () => currentPhase,
      USOS_LOGIN_TIMEOUT_MS,
      'Logowanie trwa za dlugo. Sprawdz internet i sprobuj ponownie.'
    );
    return {
      school: SCHOOL_USOS,
      cookies: [],
      credentials: packUsosStoredCredential(stored?.password || password, icalUrl)
    };
  }

  if (school === SCHOOL_WSZIP) {
    setPhase('WSZiP: otwieram Moodle w przeglądarce');
    return {
      school: SCHOOL_WSZIP,
      cookies: []
    };
  }

  if (school === SCHOOL_POLLUB) {
    const stored = unpackPollubStoredCredential(password);
    const pollubPassword = stored?.password || password;
    setPhase('POLLUB: loguję do eHMS');
    const jar = await withLoginTimeout(loginToPollub(email, pollubPassword, setPhase), () => currentPhase);
    return {
      school: SCHOOL_POLLUB,
      cookies: serializeCookieJar(jar)
    };
  }

  if (school === SCHOOL_WAT) {
    setPhase('WAT: przygotowuję logowanie');
    return {
      school: SCHOOL_WAT,
      cookies: []
    };
  }

  if (school === SCHOOL_WSEIT) {
    const stored = unpackWseitStoredCredential(password);
    const wseitPassword = stored?.password || password;
    setPhase('WSEIT: loguję do dziekanatu');
    const { jar } = await withLoginTimeout(
      loginToWseit(email, wseitPassword, setPhase, stored?.contextId ? { id: stored.contextId } : null),
      () => currentPhase
    );
    return {
      school: SCHOOL_WSEIT,
      cookies: serializeCookieJar(jar)
    };
  }

  throw new Error('Nie rozpoznano uczelni dla tego loginu.');
}

export async function loginAndFetchSchedule({
  onCredentials,
  onStudentMeta,
  onStudentProfile,
  school,
  email,
  password,
  startDateKey,
  endDateKey,
  onPhase,
  extractPdfTextLocal,
  usosSecondFactorCode = '',
  pollubPdfUri = '',
  pollubPdfUris = [],
  watFacultyId = '',
  watGroupCode = '',
  watGroupHref = '',
  wseitContextId = '',
  wseitContextLabel = ''
}) {
  let currentPhase = '';
  const setPhase = (message) => {
    currentPhase = message;
    onPhase?.(message);
  };

  if (school === SCHOOL_MERITO) {
    setPhase('Merito: przygotowuję logowanie');
    return withScheduleTimeout(
      loginAndFetchMeritoSchedule({
        login: email,
        password,
        startDateKey,
        endDateKey,
        onPhase: setPhase,
        onStudentProfile
      }),
      () => currentPhase
    );
  }

  if (school === SCHOOL_CDV) {
    setPhase('CDV: przygotowuję logowanie');
    return withScheduleTimeout(
      loginAndFetchCdvSchedule({
        email,
        password,
        startDateKey,
        endDateKey,
        onPhase: setPhase,
        onStudentProfile
      }),
      () => currentPhase
    );
  }

  if (school === SCHOOL_USOS) {
    let stored = unpackUsosStoredCredential(password);
    let credentials = password;
    if (!stored?.icalUrl) {
      setPhase('USOS: loguję i szukam linku iCal');
      const icalUrl = await withTimeout(
        loginToUsosAndFetchIcal({
          login: email,
          mfaCode: usosSecondFactorCode,
          password: stored?.password || password,
          portalUrl: portalUrlForLogin(email),
          onPhase: setPhase,
          onStudentProfile
        }),
        () => currentPhase,
        USOS_LOGIN_TIMEOUT_MS,
        'Logowanie trwa za dlugo. Sprawdz internet i sprobuj ponownie.'
      );
      const profileAfterLogin = await readStudentProfile(SCHOOL_USOS, email);
      credentials = packUsosStoredCredential(
        stored?.password || password,
        icalUrl,
        profileAfterLogin
      );
      stored = unpackUsosStoredCredential(credentials);
      onCredentials?.(credentials);
    } else {
      const existingProfile = await readStudentProfile(SCHOOL_USOS, email);
      const snapshot = usosProfileSnapshotFromStored(stored);
      const needsSemesterRefresh =
        shouldRefreshUsosStudentProfile(existingProfile)
        || shouldRefreshUsosStudentProfile({ ...existingProfile, semester: snapshot.semester });

      if (needsSemesterRefresh) {
        const { semester: _staleSemester, ...snapshotWithoutSemester } = snapshot;
        if (Object.values(snapshotWithoutSemester).some((value) => String(value || '').trim())) {
          await onStudentProfile?.(snapshotWithoutSemester);
        }
        void tryQuickUsosSemesterFromCookies({
          portalUrl: portalUrlForLogin(email),
          onStudentProfile
        });
      } else if (Object.values(snapshot).some((value) => String(value || '').trim())) {
        await onStudentProfile?.(snapshot);
      }
    }
    setPhase('USOS: przygotowuję plan');
    const events = await withScheduleTimeout(
      loginAndFetchUsosSchedule({
        credentials,
        endDateKey,
        onCredentials,
        onPhase: setPhase,
        startDateKey
      }),
      () => currentPhase
    );
    const latestStored = unpackUsosStoredCredential(credentials);
    if (latestStored?.icalUrl) {
      const latestProfile = await readStudentProfile(SCHOOL_USOS, email);
      onCredentials?.(packUsosStoredCredential(latestStored.password, latestStored.icalUrl, latestProfile));
    }
    return events;
  }

  if (school === SCHOOL_WSZIP) {
    await onStudentProfile?.(studentProfileFromLogin({ login: email, email }));
    if (!extractPdfTextLocal) {
      throw new Error('Brak lokalnego parsera PDF. Uruchom aplikację ponownie.');
    }
    const stored = unpackWszipStoredCredential(password);
    const pdfUri = stored?.pdfUri || unpackWszipPdfCredential(password);
    if (!pdfUri) {
      throw new Error('Wybierz plik PDF planu pobrany z Moodle po zalogowaniu w przeglądarce.');
    }
    setPhase('WSZiP: przygotowuję plan z PDF');
    return withScheduleTimeout(
      loginAndFetchWszipSchedule({
        pdfUri,
        startDateKey,
        endDateKey,
        onPhase: setPhase,
        extractPdfTextLocal
      }),
      () => currentPhase
    );
  }

  if (school === SCHOOL_POLLUB) {
    if (!extractPdfTextLocal) {
      throw new Error('Brak lokalnego parsera PDF. Uruchom aplikację ponownie.');
    }
    const stored = unpackPollubStoredCredential(password);
    const pollubPassword = stored?.password || password;
    const mergedPdfUris = (Array.isArray(pollubPdfUris) ? pollubPdfUris : [])
      .concat(stored?.pdfUris || [])
      .concat([pollubPdfUri, stored?.pdfUri].filter(Boolean))
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    setPhase('POLLUB: przygotowuję plan z eHMS i PDF');
    return withScheduleTimeout(
      loginAndFetchPollubSchedule({
        login: email,
        password: pollubPassword,
        pdfUri: mergedPdfUris[0] || '',
        pdfUris: mergedPdfUris,
        startDateKey,
        endDateKey,
        onPhase: setPhase,
        extractPdfTextLocal,
        onStudentMeta: async (meta) => {
          onStudentMeta?.(meta);
          await onStudentProfile?.(studentProfileFromPollub({ ...meta, login: email }));
        }
      }),
      () => currentPhase
    );
  }

  if (school === SCHOOL_WAT) {
    setPhase('WAT: przygotowuję plan');
    await onStudentProfile?.(
      studentProfileFromWat({
        facultyId: watFacultyId,
        groupCode: watGroupCode,
        login: email
      })
    );
    return withScheduleTimeout(
      loginAndFetchWatSchedule({
        login: email,
        password,
        facultyId: watFacultyId,
        groupCode: watGroupCode,
        groupHref: watGroupHref,
        startDateKey,
        endDateKey,
        onPhase: setPhase
      }),
      () => currentPhase
    );
  }

  if (school === SCHOOL_WSEIT) {
    setPhase('WSEIT: przygotowuję plan');
    return withScheduleTimeout(
      loginAndFetchWseitSchedule({
        login: email,
        password,
        startDateKey,
        endDateKey,
        onPhase: setPhase,
        onStudentProfile,
        contextId: wseitContextId,
        contextLabel: wseitContextLabel
      }),
      () => currentPhase
    );
  }

  throw new Error('Nie rozpoznano uczelni dla tego loginu.');
}
