import AsyncStorage from '@react-native-async-storage/async-storage';
import MaskedView from '@react-native-masked-view/masked-view';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Dimensions,
  Easing,
  Image,
  Keyboard,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import {
  addDays,
  buildMonthSliderItemsAround,
  dateLabel,
  daysBetween,
  endExclusiveForMode,
  eventTimeRange,
  focusRangeForEvents,
  groupEventsByDay,
  nearestUpcomingEventFocus,
  MONTHS_SHORT,
  rangeTitle,
  semesterRangeForDate,
  startForMode,
  toDateKey
} from './src/dateUtils';
import { useLocalPdfParser } from './src/LocalPdfParserProvider';
import { openMoodleInBrowser } from './src/moodleSession';
import {
  looksLikePollubStoredCredential,
  packPollubStoredCredential,
  pickPollubPdfFile,
  pollubPdfLabel,
  unpackPollubStoredCredential
} from './src/pollubClient';
import {
  looksLikeWszipPdfCredential,
  looksLikeWszipStoredCredential,
  packWszipStoredCredential,
  pickWszipPdfFile,
  unpackWszipStoredCredential,
  unpackWszipPdfCredential,
  wszipPdfLabel
} from './src/wszipClient';
import { StudentDataSection } from './src/StudentDataSection';
import {
  createEmptyStudentProfile,
  mergeAutoStudentProfile,
  readStudentProfile,
  studentProfileFromPollubLegacyMeta,
  writeStudentProfile
} from './src/studentProfile';
import { buildMeritoPortalAutofillScript, isMeritoLoginUrl } from './src/meritoPortalAutofill';
import { buildPollubPortalAutofillScript, isPollubPortalUrl } from './src/pollubPortalAutofill';
import {
  buildUsosPortalAutofillScript,
  resolveUsosPortalWebView,
  shouldInjectUsosPortalAutofill,
  usosWebViewUserAgent
} from './src/usosPortalAutofill';
import { buildPortalHandshakeScript, isUsosPortalHostUrl } from './src/usosWebViewLogin';
import { eventStatusLabel, isEventCrossedOut, refreshMeritoEvents } from './src/meritoEventStatus';
import { buildCookieHeader } from './src/portalSession';
import { eventIdentity, mergeEnrichedEvents, mergeScheduleWithExisting } from './src/eventMerge';
import { formatPlanRoomLabel, isPlanEventOnline, sanitizePlanAdditionalInfo, shouldShowPlanOnlineLink } from './src/planEventInfo';
import { loginAndFetchSchedule, loginOnly, normalizeScheduleFetchResult } from './src/scheduleClient';
import {
  beginLoginAttempt,
  cancelActiveLoginOperations,
  isLoginAttemptCurrent,
  isLoginCancelledError
} from './src/loginCancellation';
import {
  isUsosSemesterValueValid,
  sanitizeUsosSemesterValue,
  shouldRefreshUsosStudentProfile
} from './src/usosStudentProfile';
import {
  looksLikeUsosIcalUrl,
  looksLikeUsosStoredCredential,
  packUsosStoredCredential,
  tryQuickUsosSemesterFromCookies,
  unpackUsosStoredCredential,
  usosProfileSnapshotFromStored
} from './src/usosClient';
import {
  portalUrlForLogin,
  resolveSchoolForLogin,
  schoolProfileForLogin,
  SCHOOL_CDV,
  SCHOOL_MERITO,
  SCHOOL_POLLUB,
  SCHOOL_USOS,
  SCHOOL_WAT,
  SCHOOL_WSEIT,
  SCHOOL_WSZIP,
  schoolProfiles,
  usosFeaturedUniversityForLogin,
  usosUniversityForLogin
} from './src/schoolConfig';
import {
  watSemesterForDate
} from './src/watConfig';
import {
  listWatGroupsForLogin,
  looksLikeWatStoredCredential,
  packWatStoredCredential,
  unpackWatStoredCredential
} from './src/watClient';
import {
  listWseitContextsForLogin,
  looksLikeWseitStoredCredential,
  packWseitStoredCredential,
  unpackWseitStoredCredential
} from './src/wseitClient';
import { PollubHelpModal } from './src/PollubHelpModal';
import { PollubPdfManagerModal } from './src/PollubPdfManagerModal';
import { WatGroupPickerModal } from './src/WatGroupPickerModal';
import { WseitContextPickerModal } from './src/WseitContextPickerModal';
import { WszipHelpModal } from './src/WszipHelpModal';
import { WebView } from 'react-native-webview';
import appConfig from './app.json';

const EMAIL_KEY = 'cdv_plan_email';
const PASSWORD_KEY = 'cdv_plan_password';
const PLAN_CACHE_KEY = 'cdv_plan_semester_cache';
const SCHOOL_KEY = 'comamdzis_school';
const PROFILES_KEY = 'comamdzis_saved_profiles';
const REMEMBER_PROFILE_KEY = 'comamdzis_remember_profile';
const THEME_KEY = 'cdv_plan_theme';
const CARD_VISIBILITY_KEY = 'comamdzis_card_visibility';
const POLLUB_META_KEY_PREFIX = 'comamdzis_pollub_meta:';
const BACKGROUND_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const PORTAL_SESSION_TTL_MS = 30 * 60 * 1000;
const CDV_PORTAL_HOME_URL = 'https://wu.cdv.pl/?page=Main';
const CDV_BLACKBOARD_BASE_URL = 'https://cdv.blackboard.com/auth-saml/saml/login?apId=_27_1&redirectUrl=https%3A%2F%2Fcdv.blackboard.com%2Fultra';
const SECURE_STORE_TIMEOUT_MS = 5000;
const APP_ICON = require('./assets/app-icon-white-transparent.png');
const APP_ICON_WHITE = require('./assets/app-icon-white-transparent.png');
const APP_ICON_BLACK = require('./assets/app-icon-black-transparent.png');
const APP_VERSION = appConfig?.expo?.version || '0.1.0';
const CDV_LOGO = require('./assets/cdv-logo-white.png');
const MERITO_LOGO = require('./assets/merito-logo.png');
const LOGO_221 = require('./assets/logo-221.png');
const WSZIP_LOGO = LOGO_221;
const USOS_UNIVERSITY_LOGOS = {
  pw: require('./assets/pw.png'),
  uj: require('./assets/ujlogo.png'),
  umcs: require('./assets/umcs.png')
};
const PROFILE_LOGO_TINT = '#ffffff';
const FONT = {
  body: 'Krub-Regular',
  bodyBold: 'Krub-Bold',
  title: 'Inter-ExtraBold'
};
const BRAND_GRADIENT = ['#7b1cff', '#2575ff', '#19e6e6'];
const BRAND_GRADIENT_START = { x: 0, y: 1 };
const BRAND_GRADIENT_END = { x: 1, y: 0 };
const BRAND_GRADIENT_TEXT = '#ffffff';
const buildCdvBlackboardUrl = (login) => {
  const normalizedLogin = String(login || '').trim();
  if (!normalizedLogin) return CDV_BLACKBOARD_BASE_URL;
  return `${CDV_BLACKBOARD_BASE_URL}&login_hint=${encodeURIComponent(normalizedLogin)}&domain_hint=organizations`;
};
const USOS_ICAL_HELP_STEPS = [
  'Zaloguj się do systemu USOSweb swojej uczelni.',
  'Przejdź do zakładki MÓJ USOSWEB.',
  'Wejdź w Mój USOSweb → Plan zajęć.',
  'Kliknij „eksportuj” w prawym górnym rogu planu (nie mylić z „Eksportuj plan” w menu głównym).',
  'Skopiuj odnośnik z pola „Odnośnik do planu” (link iCal).',
  'Skopiuj wygenerowany link przypisany indywidualnie do Twojego konta i wklej go w polu iCal.'
];

function schoolLogoForProfile({ login, school }) {
  if (school === SCHOOL_WSZIP) return WSZIP_LOGO;
  if (school === SCHOOL_WAT) return LOGO_221;
  if (school === SCHOOL_WSEIT) return LOGO_221;
  if (school === SCHOOL_POLLUB) return LOGO_221;
  if (school === SCHOOL_MERITO) return MERITO_LOGO;
  if (school === SCHOOL_USOS) {
    const featured = usosFeaturedUniversityForLogin(login);
    if (featured) return USOS_UNIVERSITY_LOGOS[featured.id];
    return APP_ICON;
  }
  return CDV_LOGO;
}

function schoolSubtitleForProfile({ login, school }) {
  if (school === SCHOOL_USOS) {
    const university = usosUniversityForLogin(login);
    if (university?.name) return `${university.name} (USOS)`;
  }
  return schoolProfiles[school]?.subtitle || 'Uczelnia';
}

function detectedSchoolLabelForLogin(login, school) {
  if (school === SCHOOL_USOS) {
    const university = usosUniversityForLogin(login);
    if (university?.name) return `${university.name} (USOS)`;
  }

  return schoolProfiles[school]?.subtitle || 'nieznana';
}

function usosPlanLabelForLogin(login) {
  const university = usosUniversityForLogin(login);
  return university?.shortName || 'USOS';
}

function SavedProfileButton({ loading, onPress, onRemove, savedProfile, styles, theme }) {
  const featuredUsos = usosFeaturedUniversityForLogin(savedProfile.login);
  const isUsosFeatured = featuredUsos && savedProfile.school === SCHOOL_USOS;
  const logoSource = isUsosFeatured ? USOS_UNIVERSITY_LOGOS[featuredUsos.id] : schoolLogoForProfile(savedProfile);

  return (
    <View style={styles.profileButton}>
      <Pressable
        disabled={loading}
        onPress={onPress}
        style={({ pressed }) => [styles.profileButtonMain, pressed && styles.profileButtonPressed]}
      >
        <View style={[styles.profileLogoBox, styles.profileLogoBoxDark]}>
          <Image resizeMode="contain" source={logoSource} style={styles.profileSchoolLogo} />
        </View>
        <View style={styles.profileTextBlock}>
          <Text style={styles.profileLogin}>{savedProfile.login}</Text>
          <Text style={styles.profileSchool}>{schoolSubtitleForProfile(savedProfile)}</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel="Usuń zapamiętane konto"
        android_ripple={null}
        disabled={loading}
        onPress={onRemove}
        style={styles.profileRemoveButton}
      >
        <Ionicons color={theme.mutedText} name="close" size={20} />
      </Pressable>
    </View>
  );
}

function SavedProfileLoadingScreen({ profile, styles, themeName }) {
  const dotOne = useRef(new Animated.Value(0)).current;
  const dotTwo = useRef(new Animated.Value(0)).current;
  const dotThree = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.92)).current;
  const logoSource = themeName === 'dark' ? APP_ICON_WHITE : APP_ICON_BLACK;

  useEffect(() => {
    Animated.spring(logoScale, {
      friction: 7,
      tension: 80,
      toValue: 1,
      useNativeDriver: true
    }).start();

    const dotAnimation = Animated.loop(
      Animated.stagger(160, [dotOne, dotTwo, dotThree].map((dot) => (
        Animated.sequence([
          Animated.timing(dot, {
            duration: 360,
            easing: Easing.out(Easing.cubic),
            toValue: 1,
            useNativeDriver: true
          }),
          Animated.timing(dot, {
            duration: 420,
            easing: Easing.in(Easing.cubic),
            toValue: 0.28,
            useNativeDriver: true
          })
        ])
      )))
    );

    dotAnimation.start();
    return () => dotAnimation.stop();
  }, [dotOne, dotThree, dotTwo, logoScale]);

  return (
    <View style={styles.profileLoadingScreen}>
      <Animated.View style={[styles.profileLoadingLogoWrap, { transform: [{ scale: logoScale }] }]}>
        <Image resizeMode="contain" source={logoSource} style={styles.profileLoadingLogo} />
      </Animated.View>
      {profile?.login ? <Text style={styles.profileLoadingLogin}>{profile.login}</Text> : null}
      <View accessibilityLabel="Ładowanie" style={styles.profileLoadingDots}>
        {[dotOne, dotTwo, dotThree].map((dot, index) => (
          <Animated.View
            key={index}
            style={[
              styles.profileLoadingDot,
              {
                opacity: dot,
                transform: [{
                  translateY: dot.interpolate({
                    inputRange: [0, 1],
                    outputRange: [4, -4]
                  })
                }]
              }
            ]}
          >
            <LinearGradient
              colors={BRAND_GRADIENT}
              end={BRAND_GRADIENT_END}
              start={BRAND_GRADIENT_START}
              style={styles.profileLoadingDotFill}
            />
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

function BrandPillButton({ active, activeTextStyle, label, onPress, style, textStyle }) {
  if (active) {
    return (
      <Pressable onPress={onPress}>
        <LinearGradient
          colors={BRAND_GRADIENT}
          end={BRAND_GRADIENT_END}
          start={BRAND_GRADIENT_START}
          style={style}
        >
          <Text style={activeTextStyle}>{label}</Text>
        </LinearGradient>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} style={style}>
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

function ToolbarRangeTitle({ styles, text }) {
  return (
    <View style={styles.rangeTitleRow}>
      <MaskedView
        maskElement={(
          <View style={styles.rangeTitleMaskWrap}>
            <Text adjustsFontSizeToFit minimumFontScale={0.85} numberOfLines={1} style={styles.rangeTitleMask}>
              {text}
            </Text>
          </View>
        )}
        style={styles.rangeTitleGradient}
      >
        <LinearGradient
          colors={BRAND_GRADIENT}
          end={BRAND_GRADIENT_END}
          start={BRAND_GRADIENT_START}
          style={styles.rangeTitleGradientFill}
        />
      </MaskedView>
    </View>
  );
}

const DEFAULT_CARD_VISIBILITY = {
  address: true,
  group: true,
  teacher: true,
  info: true
};

const CARD_VISIBILITY_FIELDS = [
  { key: 'address', icon: 'location-outline', label: 'Adres' },
  { key: 'group', icon: 'people-outline', label: 'Grupa' },
  { key: 'teacher', icon: 'person-outline', label: 'Prowadzący' },
  { key: 'info', icon: 'information-circle-outline', label: 'Informacje' }
];

const SETTINGS_DRAWER_RATIO = 0.8;
const SETTINGS_EDGE_SWIPE_WIDTH = 28;
const SETTINGS_DRAG_OPEN_THRESHOLD = 0.35;
const SETTINGS_CONTENT_SCRIM_OPACITY = 0.45;
const SETTINGS_DRAWER_LOGO_SIZE = 72;
const SETTINGS_TOGGLE_HEIGHT = 30;
const SETTINGS_TOGGLE_WIDTH = 52;
const SETTINGS_TOGGLE_PADDING = 3;
const SETTINGS_TOGGLE_THUMB = SETTINGS_TOGGLE_HEIGHT - SETTINGS_TOGGLE_PADDING * 2;
const SETTINGS_TOGGLE_TRAVEL = SETTINGS_TOGGLE_WIDTH - SETTINGS_TOGGLE_THUMB - SETTINGS_TOGGLE_PADDING * 2;

function parseCardVisibility(raw) {
  if (!raw) return DEFAULT_CARD_VISIBILITY;
  try {
    return { ...DEFAULT_CARD_VISIBILITY, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CARD_VISIBILITY;
  }
}

const MONTH_SLIDER_YEAR_WIDTH = 56;
const MONTH_SLIDER_ITEM_WIDTH = 52;
const MONTH_SLIDER_YEARS = 5;
const MONTH_SLIDER_GAP = 4;
const MONTH_SLIDER_PADDING = 16;

function monthSliderItemWidth(item) {
  return item.type === 'year' ? MONTH_SLIDER_YEAR_WIDTH : MONTH_SLIDER_ITEM_WIDTH;
}

function monthSliderOffsetForIndex(items, index) {
  let offset = MONTH_SLIDER_PADDING;
  for (let i = 0; i < index; i += 1) {
    offset += monthSliderItemWidth(items[i]);
    offset += MONTH_SLIDER_GAP;
  }
  return offset;
}

const MonthSlider = memo(function MonthSlider({ anchorDate, items, onSelectMonth, open, styles }) {
  const scrollRef = useRef(null);
  const sliderWidthRef = useRef(0);
  const itemsRef = useRef(items);
  const highlightIndexRef = useRef(-1);
  const highlightYear = anchorDate.getFullYear();
  const highlightMonth = anchorDate.getMonth();

  itemsRef.current = items;

  const highlightIndex = useMemo(
    () =>
      items.findIndex(
        (item) =>
          item.type === 'month' &&
          item.date.getFullYear() === highlightYear &&
          item.date.getMonth() === highlightMonth
      ),
    [highlightMonth, highlightYear, items]
  );

  highlightIndexRef.current = highlightIndex;

  const scrollToHighlight = useCallback(() => {
    const index = highlightIndexRef.current;
    const list = itemsRef.current;
    if (index < 0 || !scrollRef.current || !sliderWidthRef.current) return;

    const itemOffset = monthSliderOffsetForIndex(list, index);
    const itemWidth = monthSliderItemWidth(list[index]);
    const centeredOffset = itemOffset + itemWidth / 2 - sliderWidthRef.current / 2;

    scrollRef.current.scrollTo({ x: Math.max(0, centeredOffset), animated: false });
  }, []);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => scrollToHighlight());
  }, [open, scrollToHighlight]);

  const onSliderLayout = useCallback(
    (event) => {
      const { width } = event.nativeEvent.layout;
      if (width === sliderWidthRef.current) return;
      sliderWidthRef.current = width;
      if (open) {
        requestAnimationFrame(() => scrollToHighlight());
      }
    },
    [open, scrollToHighlight]
  );

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      nestedScrollEnabled
      onLayout={onSliderLayout}
      showsHorizontalScrollIndicator={false}
      style={styles.monthSlider}
      contentContainerStyle={styles.monthSliderContent}
    >
      {items.map((item) => {
        if (item.type === 'year') {
          return (
            <View key={`year-${item.year}`} style={styles.monthSliderYear}>
              <Text style={styles.monthSliderYearText}>{item.year}</Text>
            </View>
          );
        }

        const active =
          item.date.getFullYear() === highlightYear && item.date.getMonth() === highlightMonth;

        return (
          <BrandPillButton
            active={active}
            activeTextStyle={styles.monthSliderItemTextActive}
            key={`${item.date.getFullYear()}-${item.date.getMonth()}`}
            label={MONTHS_SHORT[item.date.getMonth()]}
            onPress={() => onSelectMonth(item.date)}
            style={styles.monthSliderItem}
            textStyle={styles.monthSliderItemText}
          />
        );
      })}
    </ScrollView>
  );
});

const themes = {
  light: {
    name: 'light',
    appBg: '#FFFFFF',
    headerBg: '#050505',
    screenBg: '#FFFFFF',
    panelBg: '#ffffff',
    panelAlt: '#f5f5f5',
    surfaceBg: '#eeeeee',
    surfaceBgActive: '#dddddd',
    text: '#000000',
    fieldText: '#000000',
    mutedText: '#666666',
    secondaryText: '#525252',
    formMuted: '#999999',
    formFocus: '#000000',
    checkboxCheck: '#ffffff',
    passwordIcon: '#000000',
    primaryButtonText: '#ffffff',
    rememberText: '#000000',
    border: '#cccccc',
    metaBadgeBorder: '#d1d5db',
    divider: '#e5e5e5',
    segmentedBg: '#eeeeee',
    activeBg: '#ffffff',
    accent: '#0f8fcf',
    accentDark: '#047857',
    shadow: '#000000'
  },
  dark: {
    name: 'dark',
    appBg: '#050505',
    headerBg: '#050505',
    screenBg: '#050505',
    panelBg: '#1e1e1e',
    panelAlt: '#141414',
    surfaceBg: '#262626',
    surfaceBgActive: '#333333',
    text: '#ffffff',
    fieldText: '#ffffff',
    mutedText: '#aaaaaa',
    secondaryText: '#cccccc',
    formMuted: '#666666',
    formFocus: '#ffffff',
    checkboxCheck: '#ffffff',
    passwordIcon: '#ffffff',
    primaryButtonText: '#ffffff',
    rememberText: '#ffffff',
    border: '#404040',
    metaBadgeBorder: '#525252',
    divider: '#333333',
    segmentedBg: '#2a2a2a',
    activeBg: '#3a3a3a',
    accent: '#2fb9e6',
    accentDark: '#55d6a6',
    shadow: '#000000'
  }
};

function describeChanges(previousEvents, nextEvents) {
  if (!previousEvents.length) return null;

  const previous = new Map(previousEvents.map((event) => [eventIdentity(event), event]));
  const next = new Map(nextEvents.map((event) => [eventIdentity(event), event]));
  const added = nextEvents.filter((event) => !previous.has(eventIdentity(event)));
  const removed = previousEvents.filter((event) => !next.has(eventIdentity(event)));

  if (!added.length && !removed.length) return null;

  const parts = [];
  if (added.length) {
    parts.push(`Nowe zajęcia: ${added.length}`);
    parts.push(...added.slice(0, 3).map((event) => `+ ${dateLabel(new Date(event.start))}, ${eventTimeRange(event)} ${event.title}`));
  }
  if (removed.length) {
    parts.push(`Odwołane/usunięte zajęcia: ${removed.length}`);
    parts.push(...removed.slice(0, 3).map((event) => `- ${dateLabel(new Date(event.start))}, ${eventTimeRange(event)} ${event.title}`));
  }
  if (added.length + removed.length > 6) parts.push('Pokazuję tylko kilka pierwszych zmian.');

  return parts.join('\n');
}

function safeStorageKeyPart(value) {
  return String(value || 'default').trim().toLowerCase().replace(/[^A-Za-z0-9._-]/g, '_');
}

function cacheKeyForSchool(school) {
  return `${PLAN_CACHE_KEY}_${school}`;
}

function cacheKeyForProfile(school, login) {
  return `${PLAN_CACHE_KEY}_${safeStorageKeyPart(school)}_${safeStorageKeyPart(login)}`;
}

async function readPlanCache(school, login) {
  const cacheKeys = [
    login ? cacheKeyForProfile(school, login) : '',
    cacheKeyForSchool(school),
    school === SCHOOL_CDV ? PLAN_CACHE_KEY : ''
  ].filter(Boolean);
  const rawValues = await Promise.all(cacheKeys.map((key) => AsyncStorage.getItem(key)));
  const raw = rawValues.find(Boolean);
  if (!raw) return null;

  try {
    const cache = JSON.parse(raw);
    if (Array.isArray(cache?.events)) {
      cache.events = refreshMeritoEvents(cache.events);
    }
    return cache;
  } catch {
    return null;
  }
}

async function writePlanCache(school, login, cache) {
  const raw = JSON.stringify(cache);
  await AsyncStorage.setItem(cacheKeyForProfile(school, login), raw);
}

function profileIdFor(login, school) {
  return `${school}:${String(login || '').trim().toLowerCase()}`;
}

function profilePasswordKey(profileId) {
  return `comamdzis_profile_password_${safeStorageKeyPart(profileId)}`;
}

async function readSavedProfiles() {
  const raw = await AsyncStorage.getItem(PROFILES_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeSavedProfiles(profiles) {
  await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

function withTimeout(promise, message, timeoutMs = SECURE_STORE_TIMEOUT_MS) {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function secureGetItem(key, label) {
  return withTimeout(SecureStore.getItemAsync(key), `SecureStore: odczyt ${label} trwa za długo.`);
}

function secureSetItem(key, value, label) {
  return withTimeout(SecureStore.setItemAsync(key, value), `SecureStore: zapis ${label} trwa za długo.`);
}

function secureDeleteItem(key, label) {
  return withTimeout(SecureStore.deleteItemAsync(key), `SecureStore: usuwanie ${label} trwa za długo.`);
}

async function upsertSavedProfile({ login, password, school }) {
  const trimmedLogin = login.trim();
  const id = profileIdFor(trimmedLogin, school);
  const previous = await readSavedProfiles();
  const nextProfile = {
    id,
    login: trimmedLogin,
    school,
    updatedAt: new Date().toISOString()
  };
  const next = [nextProfile, ...previous.filter((profile) => profile.id !== id)];

  await Promise.all([
    writeSavedProfiles(next),
    secureSetItem(profilePasswordKey(id), password, 'hasła profilu')
  ]);

  return next;
}

async function removeSavedProfile(profileId) {
  const next = (await readSavedProfiles()).filter((profile) => profile.id !== profileId);

  await Promise.all([
    writeSavedProfiles(next),
    secureDeleteItem(profilePasswordKey(profileId), 'hasła profilu').catch(() => {})
  ]);

  return next;
}

function buildPortalAutoLogin(activeSchool, email, password) {
  const login = String(email || '').trim();
  if (!login || !password) return null;

  if (activeSchool === SCHOOL_MERITO) {
    return { email: login, password, school: SCHOOL_MERITO };
  }

  if (activeSchool === SCHOOL_POLLUB) {
    const stored = unpackPollubStoredCredential(password);
    const portalPassword = stored?.password || password;
    if (!portalPassword) return null;
    return { email: login, password: portalPassword, school: SCHOOL_POLLUB };
  }

  return null;
}

export default function App() {
  const { extractPdfTextLocal } = useLocalPdfParser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('today');
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [portalWebView, setPortalWebView] = useState(null);
  const [themeName, setThemeName] = useState('light');
  const [school, setSchool] = useState(SCHOOL_CDV);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [rememberProfile, setRememberProfile] = useState(true);
  const [savedProfiles, setSavedProfiles] = useState([]);
  const [profileLoginLoadingProfile, setProfileLoginLoadingProfile] = useState(null);
  const [loginPhase, setLoginPhase] = useState('');
  const [deleteProfileConfirm, setDeleteProfileConfirm] = useState(null);
  const [usosHelpVisible, setUsosHelpVisible] = useState(false);
  const [usosIcalManagerVisible, setUsosIcalManagerVisible] = useState(false);
  const [wszipHelpVisible, setWszipHelpVisible] = useState(false);
  const [pollubHelpVisible, setPollubHelpVisible] = useState(false);
  const [pollubPdfManagerVisible, setPollubPdfManagerVisible] = useState(false);
  const [wszipPdfManagerVisible, setWszipPdfManagerVisible] = useState(false);
  const [wszipPdfUri, setWszipPdfUri] = useState('');
  const [usosIcalUrl, setUsosIcalUrl] = useState('');
  const [usosIcalInputVisible, setUsosIcalInputVisible] = useState(false);
  const [usosSecondFactorCode, setUsosSecondFactorCode] = useState('');
  const [usosSecondFactorRequired, setUsosSecondFactorRequired] = useState(false);
  const [pollubPdfUris, setPollubPdfUris] = useState([]);
  const [monthSliderOpen, setMonthSliderOpen] = useState(false);
  const [cardVisibility, setCardVisibility] = useState(DEFAULT_CARD_VISIBILITY);
  const [studentProfile, setStudentProfile] = useState(createEmptyStudentProfile);
  const [watFacultyId, setWatFacultyId] = useState('wml');
  const [watGroups, setWatGroups] = useState([]);
  const [watSelectedGroup, setWatSelectedGroup] = useState('');
  const [watSelectedGroupHref, setWatSelectedGroupHref] = useState('');
  const [watGroupFilter, setWatGroupFilter] = useState('');
  const [watGroupsLoading, setWatGroupsLoading] = useState(false);
  const [watGroupsError, setWatGroupsError] = useState('');
  const [watGroupPickerVisible, setWatGroupPickerVisible] = useState(false);
  const [wseitContexts, setWseitContexts] = useState([]);
  const [wseitSelectedContextId, setWseitSelectedContextId] = useState('');
  const [wseitSelectedContextLabel, setWseitSelectedContextLabel] = useState('');
  const [wseitContextFilter, setWseitContextFilter] = useState('');
  const [wseitContextsLoading, setWseitContextsLoading] = useState(false);
  const [wseitContextsError, setWseitContextsError] = useState('');
  const [wseitContextPickerVisible, setWseitContextPickerVisible] = useState(false);

  const eventsRef = useRef([]);
  const syncInProgressRef = useRef(false);
  const portalSessionCacheRef = useRef(null);
  const enrichInProgressRef = useRef(false);
  const enrichSyncGenerationRef = useRef(0);
  const pendingEnrichedRef = useRef([]);
  const enrichFlushTimerRef = useRef(null);
  const loginPhaseRef = useRef('');
  const usosSecondFactorCodeRef = useRef('');
  const wszipPdfUriRef = useRef('');
  const usosIcalUrlRef = useRef('');
  const pollubPdfUrisRef = useRef([]);
  const watFacultyIdRef = useRef('wml');
  const watSelectedGroupRef = useRef('');
  const watSelectedGroupHrefRef = useRef('');
  const watGroupPickerDismissedForEmailRef = useRef('');
  const wseitSelectedContextIdRef = useRef('');
  const wseitSelectedContextLabelRef = useRef('');
  const wseitContextPickerDismissedForEmailRef = useRef('');
  const anchorDateRef = useRef(anchorDate);
  const modeRef = useRef(mode);
  const detectedSchool = resolveSchoolForLogin(email, password);
  const loginSchool = saved ? school : detectedSchool;
  const profile = schoolProfileForLogin(loginSchool);
  const isUsosLogin = loginSchool === SCHOOL_USOS;
  const isWszipLogin = loginSchool === SCHOOL_WSZIP;
  const isPollubLogin = loginSchool === SCHOOL_POLLUB;
  const isWatLogin = loginSchool === SCHOOL_WAT;
  const isWseitLogin = loginSchool === SCHOOL_WSEIT;
  const hasWszipPdf = isWszipLogin && Boolean(wszipPdfUri);
  const hasUsosIcal = isUsosLogin && Boolean(usosIcalUrl);
  const hasPollubPdf = isPollubLogin && pollubPdfUris.length > 0;
  const loginKeyboardType = isPollubLogin || isWseitLogin ? 'default' : 'email-address';
  const filteredWatGroups = useMemo(() => {
    const query = watGroupFilter.trim().toUpperCase();
    if (!query) return watGroups;
    return watGroups.filter((group) => group.code.toUpperCase().includes(query));
  }, [watGroupFilter, watGroups]);
  const filteredWseitContexts = useMemo(() => {
    const query = wseitContextFilter.trim().toLowerCase();
    if (!query) return wseitContexts;
    return wseitContexts.filter((context) => context.label.toLowerCase().includes(query));
  }, [wseitContextFilter, wseitContexts]);
  const theme = themes[themeName];
  const [fontsLoaded] = useFonts({
    [FONT.body]: require('./assets/fonts/Krub-Regular.ttf'),
    [FONT.bodyBold]: require('./assets/fonts/Krub-Bold.ttf'),
    [FONT.title]: require('./assets/fonts/Inter-ExtraBold.ttf')
  });
  const styles = useMemo(() => createStyles(theme), [theme]);
  const semesterRange = useMemo(() => semesterRangeForDate(anchorDate), [anchorDate]);
  const semesterSyncKey = useMemo(() => {
    if (school === SCHOOL_WSZIP) return 'wszip-pdf';
    if (school === SCHOOL_POLLUB) return 'pollub-ehms';
    return `${semesterRange.startKey}:${semesterRange.endKey}`;
  }, [school, semesterRange]);
  const monthSliderItems = useMemo(
    () => buildMonthSliderItemsAround(new Date(), MONTH_SLIDER_YEARS, MONTH_SLIDER_YEARS),
    []
  );

  const range = useMemo(() => {
    const start = startForMode(anchorDate, mode);
    const end = endExclusiveForMode(anchorDate, mode);
    return {
      start,
      end,
      startKey: toDateKey(start),
      endKey: toDateKey(end),
      title: rangeTitle(start, end, mode)
    };
  }, [anchorDate, mode]);

  const visibleEvents = useMemo(() => {
    return events.filter((event) => {
      const start = new Date(event.start);
      return start >= range.start && start < range.end;
    });
  }, [events, range]);

  const groupedEvents = useMemo(() => groupEventsByDay(visibleEvents), [visibleEvents]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    anchorDateRef.current = anchorDate;
  }, [anchorDate]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    usosSecondFactorCodeRef.current = usosSecondFactorCode;
  }, [usosSecondFactorCode]);

  const updateUsosSecondFactorCode = useCallback((value) => {
    usosSecondFactorCodeRef.current = value;
    setUsosSecondFactorCode(value);
  }, []);

  useEffect(() => {
    restoreCredentialsAndCache();
  }, []);

  useEffect(() => {
    watFacultyIdRef.current = watFacultyId;
  }, [watFacultyId]);

  useEffect(() => {
    watSelectedGroupRef.current = watSelectedGroup;
  }, [watSelectedGroup]);

  useEffect(() => {
    watSelectedGroupHrefRef.current = watSelectedGroupHref;
  }, [watSelectedGroupHref]);

  useEffect(() => {
    wseitSelectedContextIdRef.current = wseitSelectedContextId;
  }, [wseitSelectedContextId]);

  useEffect(() => {
    wseitSelectedContextLabelRef.current = wseitSelectedContextLabel;
  }, [wseitSelectedContextLabel]);

  useEffect(() => {
    if (!isWseitLogin || !email.trim() || !password) {
      setWseitContexts([]);
      setWseitContextsError('');
      return undefined;
    }

    let cancelled = false;
    setWseitContextsLoading(true);
    setWseitContextsError('');

    const stored = unpackWseitStoredCredential(password);
    listWseitContextsForLogin({
      login: email.trim(),
      password: stored?.password || password,
      onPhase: () => {}
    })
      .then((contexts) => {
        if (cancelled) return;
        setWseitContexts(contexts);
        if (
          wseitSelectedContextId &&
          !contexts.some((context) => context.id === wseitSelectedContextId)
        ) {
          setWseitSelectedContextId('');
          setWseitSelectedContextLabel('');
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setWseitContexts([]);
        setWseitContextsError(error.message || 'Nie udało się pobrać profili studiów.');
      })
      .finally(() => {
        if (!cancelled) setWseitContextsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isWseitLogin, email, password]);

  useEffect(() => {
    if (!isWatLogin) {
      setWatGroups([]);
      setWatGroupsError('');
      return undefined;
    }

    let cancelled = false;
    setWatGroupsLoading(true);
    setWatGroupsError('');

    listWatGroupsForLogin({
      facultyId: watFacultyId,
      onPhase: () => {}
    })
      .then(({ groups }) => {
        if (cancelled) return;
        setWatGroups(groups);
        if (watSelectedGroup && !groups.some((g) => g.code === watSelectedGroup)) {
          setWatSelectedGroup('');
          setWatSelectedGroupHref('');
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setWatGroups([]);
        setWatGroupsError(error.message || 'Nie udało się pobrać listy grup.');
      })
      .finally(() => {
        if (!cancelled) setWatGroupsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isWatLogin, watFacultyId]);

  useEffect(() => {
    if (saved) return undefined;

    const login = email.trim();
    if (!login || detectedSchool !== SCHOOL_WAT) {
      if (detectedSchool !== SCHOOL_WAT) {
        setWatGroupPickerVisible(false);
        watGroupPickerDismissedForEmailRef.current = '';
      }
      return undefined;
    }

    if (watSelectedGroup || watGroupPickerDismissedForEmailRef.current === login) {
      return undefined;
    }

    setWatGroupPickerVisible(true);
    return undefined;
  }, [saved, email, detectedSchool, watSelectedGroup]);

  useEffect(() => {
    if (saved) return undefined;

    const login = email.trim();
    if (!login || detectedSchool !== SCHOOL_WSEIT) {
      if (detectedSchool !== SCHOOL_WSEIT) {
        setWseitContextPickerVisible(false);
        wseitContextPickerDismissedForEmailRef.current = '';
      }
      return undefined;
    }

    if (!password) return undefined;

    if (wseitSelectedContextId || wseitContextPickerDismissedForEmailRef.current === login) {
      return undefined;
    }

    setWseitContextPickerVisible(true);
    return undefined;
  }, [saved, email, password, detectedSchool, wseitSelectedContextId]);

  const closeWatGroupPicker = useCallback(() => {
    watGroupPickerDismissedForEmailRef.current = email.trim();
    setWatGroupPickerVisible(false);
  }, [email]);

  const confirmWatGroupPicker = useCallback(() => {
    if (!watSelectedGroupRef.current) {
      Alert.alert('Brak grupy', 'Wybierz grupę z listy.');
      return;
    }
    watGroupPickerDismissedForEmailRef.current = email.trim();
    setWatGroupPickerVisible(false);
  }, [email]);

  const handleWatGroupSelect = useCallback((group) => {
    setWatSelectedGroup(group.code);
    setWatSelectedGroupHref(group.scheduleUrl || group.href);
  }, []);

  const closeWseitContextPicker = useCallback(() => {
    wseitContextPickerDismissedForEmailRef.current = email.trim();
    setWseitContextPickerVisible(false);
  }, [email]);

  const confirmWseitContextPicker = useCallback(() => {
    if (!wseitSelectedContextIdRef.current) {
      Alert.alert('Brak profilu', 'Wybierz profil studiów z listy.');
      return;
    }
    wseitContextPickerDismissedForEmailRef.current = email.trim();
    setWseitContextPickerVisible(false);
  }, [email]);

  const handleWseitContextSelect = useCallback((context) => {
    setWseitSelectedContextId(context.id);
    setWseitSelectedContextLabel(context.label);
  }, []);

  const updateLoginPhase = useCallback((message = '') => {
    loginPhaseRef.current = message;
    setLoginPhase(message);
  }, []);

  const rememberPortalSession = useCallback((activeSchool, portalCookies) => {
    if (!portalCookies?.length) return;
    portalSessionCacheRef.current = {
      school: activeSchool,
      cookies: portalCookies,
      fetchedAt: Date.now()
    };
  }, []);

  const cancelPendingEnrichFlush = useCallback(() => {
    if (enrichFlushTimerRef.current) {
      clearTimeout(enrichFlushTimerRef.current);
      enrichFlushTimerRef.current = null;
    }
    pendingEnrichedRef.current = [];
  }, []);

  const cancelActiveLogin = useCallback(() => {
    cancelActiveLoginOperations();
    syncInProgressRef.current = false;
    enrichSyncGenerationRef.current += 1;
    cancelPendingEnrichFlush();
    enrichInProgressRef.current = false;
    setProfileLoginLoadingProfile(null);
    setLoading(false);
    setSyncing(false);
    updateLoginPhase('');
  }, [cancelPendingEnrichFlush, updateLoginPhase]);

  const enrichScheduleDetailsInBackground = useCallback(async ({ activeSchool, enrichDetails, loginEmail, syncGeneration }) => {
    if (!enrichDetails) return;
    if (syncGeneration !== undefined && syncGeneration !== enrichSyncGenerationRef.current) return;

    if (enrichInProgressRef.current) {
      cancelPendingEnrichFlush();
      enrichInProgressRef.current = false;
    }

    const myGeneration = syncGeneration ?? enrichSyncGenerationRef.current;
    enrichInProgressRef.current = true;
    pendingEnrichedRef.current = [];

    const isStale = () => myGeneration !== enrichSyncGenerationRef.current;

    const flushEnrichedBatch = () => {
      if (isStale()) return;
      const batch = pendingEnrichedRef.current;
      if (!batch.length) return;
      pendingEnrichedRef.current = [];
      setEvents((current) => {
        const merged = mergeEnrichedEvents(current, batch);
        eventsRef.current = merged;
        return merged;
      });
    };

    const queueEnrichedEvent = (enriched) => {
      if (isStale()) return;
      pendingEnrichedRef.current.push(enriched);
      if (enrichFlushTimerRef.current) return;
      enrichFlushTimerRef.current = setTimeout(() => {
        enrichFlushTimerRef.current = null;
        flushEnrichedBatch();
      }, 120);
    };

    try {
      await enrichDetails({
        focusDate: anchorDateRef.current,
        onEventEnriched: queueEnrichedEvent
      });
      if (isStale()) return;
      if (enrichFlushTimerRef.current) {
        clearTimeout(enrichFlushTimerRef.current);
        enrichFlushTimerRef.current = null;
      }
      flushEnrichedBatch();
      await writePlanCache(activeSchool, loginEmail, {
        events: eventsRef.current,
        lastSync: new Date().toISOString(),
        semesterStartKey: semesterRange.startKey,
        semesterEndKey: semesterRange.endKey
      });
    } catch {
      // podstawowy plan jest juz widoczny
    } finally {
      if (!isStale()) {
        enrichInProgressRef.current = false;
      }
    }
  }, [cancelPendingEnrichFlush, semesterRange]);

  const applyAutoStudentProfile = useCallback(async (activeSchool, loginEmail, autoPatch, credentialOverride) => {
    if (!activeSchool || !loginEmail || !autoPatch) return;
    const stored = await readStudentProfile(activeSchool, loginEmail);
    const baseProfile =
      activeSchool === SCHOOL_USOS ? { ...stored, manualFields: [] } : stored;
    const merged = mergeAutoStudentProfile(baseProfile, autoPatch);
    if (activeSchool === SCHOOL_USOS) {
      const incomingSemester = sanitizeUsosSemesterValue(autoPatch?.semester);
      if (isUsosSemesterValueValid(incomingSemester)) {
        merged.semester = incomingSemester;
      } else {
        merged.semester = sanitizeUsosSemesterValue(merged.semester);
      }
      merged.manualFields = (merged.manualFields || []).filter((key) => key !== 'semester');
    }
    await writeStudentProfile(activeSchool, loginEmail, merged);
    setStudentProfile(merged);

    if (activeSchool === SCHOOL_USOS && (merged.semester || merged.fullName)) {
      try {
        const credentialValue = credentialOverride ?? password;
        const creds = unpackUsosStoredCredential(credentialValue);
        if (creds?.icalUrl) {
          await persistUsosCredentials(creds.password || credentialValue, creds.icalUrl, merged);
        }
      } catch {
        // opcjonalny zapis kopii profilu przy poświadczeniach USOS
      }
    }
    return merged;
  }, [password]);

  const scheduleUsosSemesterBackgroundRefresh = useCallback((loginEmail, credentialOverride) => {
    if (!loginEmail) return;
    void (async () => {
      const current = await readStudentProfile(SCHOOL_USOS, loginEmail);
      if (!shouldRefreshUsosStudentProfile(current)) return;
      await tryQuickUsosSemesterFromCookies({
        portalUrl: portalUrlForLogin(loginEmail),
        onStudentProfile: (patch) =>
          applyAutoStudentProfile(SCHOOL_USOS, loginEmail, patch, credentialOverride ?? password)
      });
    })();
  }, [applyAutoStudentProfile, password]);

  const loadStudentProfileForAccount = useCallback(async (activeSchool, loginEmail, credentialOverride) => {
    if (!activeSchool || !loginEmail) {
      setStudentProfile(createEmptyStudentProfile());
      return;
    }

    const credentialValue = credentialOverride ?? password;
    let profile = await readStudentProfile(activeSchool, loginEmail);
    const legacyPollubKey = `${POLLUB_META_KEY_PREFIX}${safeStorageKeyPart(loginEmail)}`;
    const legacyPollubRaw = await AsyncStorage.getItem(legacyPollubKey);
    if (legacyPollubRaw) {
      try {
        profile = mergeAutoStudentProfile(profile, studentProfileFromPollubLegacyMeta(JSON.parse(legacyPollubRaw)));
      } catch {
        // ignore legacy payload
      }
    }
    if (activeSchool === SCHOOL_CDV) {
      profile = {
        ...profile,
        university: 'Collegium Da Vinci'
      };
    }
    if (activeSchool === SCHOOL_POLLUB && !profile.university) {
      profile = {
        ...profile,
        university: 'Politechnika Lubelska'
      };
    }
    if (activeSchool === SCHOOL_WSEIT && !profile.university) {
      profile = {
        ...profile,
        university: 'WSEIT'
      };
    }
    if (activeSchool === SCHOOL_USOS) {
      const creds = unpackUsosStoredCredential(credentialValue);
      const snapshot = usosProfileSnapshotFromStored(creds);
      if (shouldRefreshUsosStudentProfile(profile) || shouldRefreshUsosStudentProfile({ ...profile, semester: snapshot.semester })) {
        const { semester: _staleSemester, ...snapshotWithoutSemester } = snapshot;
        profile = mergeAutoStudentProfile(profile, snapshotWithoutSemester);
      } else {
        profile = mergeAutoStudentProfile(profile, snapshot);
      }
      const cleanedSemester = sanitizeUsosSemesterValue(profile.semester);
      if (cleanedSemester !== profile.semester) {
        profile = {
          ...profile,
          semester: cleanedSemester,
          manualFields: (profile.manualFields || []).filter((key) => key !== 'semester')
        };
        await writeStudentProfile(activeSchool, loginEmail, profile);
      }
      profile = await readStudentProfile(activeSchool, loginEmail);
    }
    setStudentProfile(profile);
    if (activeSchool === SCHOOL_USOS && shouldRefreshUsosStudentProfile(profile)) {
      scheduleUsosSemesterBackgroundRefresh(loginEmail, credentialValue);
    }
  }, [password, scheduleUsosSemesterBackgroundRefresh]);

  const syncSemester = useCallback(
    async ({
      nextEmail = email,
      nextPassword = password,
      showLoader = false,
      notifyChanges = true,
      showErrors = false,
      forceStart = false
    } = {}) => {
      if (!nextEmail?.trim() || !nextPassword) return false;
      if (syncInProgressRef.current) {
        if (!forceStart) return false;
        syncInProgressRef.current = false;
      }

      const nextSchool = resolveSchoolForLogin(nextEmail, nextPassword);
      syncInProgressRef.current = true;
      const attemptId = beginLoginAttempt();
      if (showLoader || !eventsRef.current.length) setLoading(true);
      else setSyncing(true);
      updateLoginPhase(`Start logowania: ${schoolProfiles[nextSchool]?.subtitle || 'uczelnia'}`);

      try {
        let syncPassword = nextPassword;
        let syncPollubPdfUri = pollubPdfUrisRef.current[0] || '';
        if (nextSchool === SCHOOL_WSZIP) {
          const stored = unpackWszipStoredCredential(nextPassword);
          const syncWszipPdfUri = wszipPdfUriRef.current || stored?.pdfUri || unpackWszipPdfCredential(nextPassword);
          if (!syncWszipPdfUri) return false;
          syncPassword = packWszipStoredCredential(syncWszipPdfUri);
        }
        if (nextSchool === SCHOOL_USOS) {
          const stored = unpackUsosStoredCredential(nextPassword);
          const syncUsosPassword = stored?.password || nextPassword;
          const syncUsosIcalUrl = usosIcalUrlRef.current || stored?.icalUrl || '';
          if (!syncUsosIcalUrl) return false;
          const syncUsosProfile = await readStudentProfile(SCHOOL_USOS, nextEmail.trim());
          syncPassword = packUsosStoredCredential(syncUsosPassword, syncUsosIcalUrl, syncUsosProfile);
        }
        if (nextSchool === SCHOOL_POLLUB) {
          const stored = unpackPollubStoredCredential(nextPassword);
          syncPassword = stored?.password || nextPassword;
          syncPollubPdfUri = pollubPdfUrisRef.current[0] || stored?.pdfUris?.[0] || stored?.pdfUri || '';
          if (!syncPassword) return false;
        }
        if (nextSchool === SCHOOL_WAT) {
          const stored = unpackWatStoredCredential(nextPassword);
          syncPassword =
            stored?.password && stored?.groupCode
              ? packWatStoredCredential(stored.password, {
                  facultyId: stored.facultyId,
                  groupCode: stored.groupCode,
                  groupHref: stored.groupHref,
                  semesterFolder: stored.semesterFolder,
                  semesterTerm: stored.semesterTerm
                })
              : nextPassword;
          if (!stored?.groupCode && !watSelectedGroupRef.current) return false;
        }
        if (nextSchool === SCHOOL_WSEIT) {
          const stored = unpackWseitStoredCredential(nextPassword);
          syncPassword =
            stored?.password && stored?.contextId
              ? packWseitStoredCredential(stored.password, {
                  contextId: stored.contextId,
                  contextLabel: stored.contextLabel
                })
              : nextPassword;
          if (!stored?.contextId && !wseitSelectedContextIdRef.current) return false;
        }

        const scheduleResult = normalizeScheduleFetchResult(await loginAndFetchSchedule({
          school: nextSchool,
          email: nextEmail.trim(),
          password: syncPassword,
          startDateKey: semesterRange.startKey,
          endDateKey: semesterRange.endKey,
          onPhase: updateLoginPhase,
          onStudentProfile: (autoPatch) => applyAutoStudentProfile(nextSchool, nextEmail.trim(), autoPatch),
          extractPdfTextLocal,
          usosSecondFactorCode: usosSecondFactorCodeRef.current.trim(),
          pollubPdfUri: syncPollubPdfUri,
          pollubPdfUris: pollubPdfUrisRef.current,
          watFacultyId: watFacultyIdRef.current,
          watGroupCode: watSelectedGroupRef.current,
          watGroupHref: watSelectedGroupHrefRef.current,
          wseitContextId: wseitSelectedContextIdRef.current,
          wseitContextLabel: wseitSelectedContextLabelRef.current
        }));
        if (!isLoginAttemptCurrent(attemptId)) return false;
        const previousEvents = eventsRef.current;
        enrichSyncGenerationRef.current += 1;
        const syncGeneration = enrichSyncGenerationRef.current;
        cancelPendingEnrichFlush();
        enrichInProgressRef.current = false;

        const nextEvents = mergeScheduleWithExisting(previousEvents, scheduleResult.events);
        rememberPortalSession(nextSchool, scheduleResult.portalCookies);
        if (nextSchool === SCHOOL_POLLUB) {
          applyDiscoveredPollubPdfUris(scheduleResult.discoveredPollubPdfUris);
        }
        const changes = notifyChanges ? describeChanges(previousEvents, nextEvents) : null;
        const syncedAt = new Date();

        eventsRef.current = nextEvents;
        setEvents(nextEvents);
        if (nextSchool === SCHOOL_USOS) {
          setUsosSecondFactorRequired(false);
          updateUsosSecondFactorCode('');
          scheduleUsosSemesterBackgroundRefresh(nextEmail.trim(), syncPassword);
        }
        setLastSync(syncedAt);
        await writePlanCache(nextSchool, nextEmail.trim(), {
          events: nextEvents,
          lastSync: syncedAt.toISOString(),
          semesterStartKey: semesterRange.startKey,
          semesterEndKey: semesterRange.endKey
        });

        if (scheduleResult.enrichDetails) {
          void enrichScheduleDetailsInBackground({
            activeSchool: nextSchool,
            enrichDetails: scheduleResult.enrichDetails,
            loginEmail: nextEmail.trim(),
            syncGeneration
          });
        }

        if (changes) {
          Alert.alert('Zmiany w planie', changes);
        }
        return true;
      } catch (error) {
        if (!isLoginAttemptCurrent(attemptId) || isLoginCancelledError(error)) {
          return false;
        }
        if (error?.code === 'USOS_2FA_REQUIRED') {
          setUsosSecondFactorRequired(true);
        }
        if (error?.code !== 'USOS_2FA_REQUIRED' && (showErrors || !eventsRef.current.length)) {
          const phase = loginPhaseRef.current ? `Etap: ${loginPhaseRef.current}\n\n` : '';
          Alert.alert('Nie udało się wczytać planu', `${phase}${error.message || 'Dane logowania są nieprawidłowe.'}`);
        }
        return false;
      } finally {
        setLoading(false);
        setSyncing(false);
        syncInProgressRef.current = false;
        updateLoginPhase('');
      }
    },
    [applyAutoStudentProfile, cancelPendingEnrichFlush, email, enrichScheduleDetailsInBackground, extractPdfTextLocal, password, rememberPortalSession, scheduleUsosSemesterBackgroundRefresh, semesterRange, updateLoginPhase, updateUsosSecondFactorCode]
  );

  useEffect(() => {
    if (!saved || !email || !password) return undefined;

    syncSemester({ notifyChanges: eventsRef.current.length > 0, showErrors: eventsRef.current.length === 0 });

    const interval = setInterval(() => {
      syncSemester({ notifyChanges: true, showErrors: false });
    }, BACKGROUND_SYNC_INTERVAL_MS);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        syncSemester({ notifyChanges: true, showErrors: false });
      }
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [email, password, saved, semesterSyncKey, syncSemester]);

  const toggleCardVisibility = useCallback((key) => {
    setCardVisibility((current) => {
      const next = { ...current, [key]: !current[key] };
      AsyncStorage.setItem(CARD_VISIBILITY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const selectMonth = useCallback((date) => {
    setMode('month');
    setAnchorDate(new Date(date.getFullYear(), date.getMonth(), 1));
  }, []);

  const openCdvPortal = useCallback(async ({ target = 'wu', title, url }) => {
    const portalAutoLogin = email.trim() && password
      ? { email: email.trim(), password, school: SCHOOL_CDV, target }
      : null;

    if (!url) return;

    setSettingsOpen(false);

    const cachedPortal = portalSessionCacheRef.current;
    if (
      cachedPortal?.school === SCHOOL_CDV &&
      cachedPortal.cookies?.length &&
      Date.now() - cachedPortal.fetchedAt < PORTAL_SESSION_TTL_MS
    ) {
      setPortalWebView({
        autoLogin: portalAutoLogin,
        cookies: cachedPortal.cookies,
        title,
        url
      });
      return;
    }

    if (!email.trim() || !password) {
      Linking.openURL(url).catch(() => {});
      return;
    }

    setPortalWebView({ autoLogin: portalAutoLogin, loading: true, title, url });

    try {
      const portalSession = await loginOnly({
        school: SCHOOL_CDV,
        email: email.trim(),
        password,
        onPhase: () => {}
      });
      rememberPortalSession(SCHOOL_CDV, portalSession.cookies || []);
      setPortalWebView({
        autoLogin: portalAutoLogin,
        cookies: portalSession.cookies || [],
        title,
        url
      });
    } catch {
      setPortalWebView(null);
      Linking.openURL(url).catch(() => {});
    }
  }, [email, password, rememberPortalSession]);

  const openUniversityPortal = useCallback(async () => {
    const activeSchool = school || resolveSchoolForLogin(email, password);
    const profile = schoolProfiles[activeSchool] || schoolProfiles[SCHOOL_CDV];
    const url = activeSchool === SCHOOL_USOS
      ? portalUrlForLogin(email)
      : activeSchool === SCHOOL_CDV
        ? CDV_PORTAL_HOME_URL
        : profile.portalUrl;

    if (!url) return;

    setSettingsOpen(false);

    if (activeSchool === SCHOOL_CDV) {
      openCdvPortal({ title: 'Twoja Uczelnia', url });
      return;
    }

    if (activeSchool === SCHOOL_USOS) {
      const stored = unpackUsosStoredCredential(password);
      const loginEmail = email.trim();
      const loginPassword = stored?.password || password;
      const { autoLogin, url: startUrl } = resolveUsosPortalWebView({
        email: loginEmail,
        password: loginPassword,
        portalUrl: url
      });

      if (!autoLogin) {
        Linking.openURL(url).catch(() => {});
        return;
      }

      setPortalWebView({
        autoLogin: { ...autoLogin, school: SCHOOL_USOS },
        title: 'Twoja Uczelnia',
        url: startUrl
      });
      return;
    }

    if (activeSchool === SCHOOL_WSZIP) {
      openMoodleInBrowser().catch(() => {});
      return;
    }

    if (activeSchool === SCHOOL_WAT) {
      Linking.openURL('https://www.wojsko-polskie.pl/wat/rozklady-zajec/').catch(() => {});
      return;
    }

    if (activeSchool === SCHOOL_WSEIT) {
      Linking.openURL('https://wd.wseit.pl/Logowanie').catch(() => {});
      return;
    }

    const portalAutoLogin = buildPortalAutoLogin(activeSchool, email, password);

    const cachedPortal = portalSessionCacheRef.current;
    if (
      cachedPortal?.school === activeSchool &&
      cachedPortal.cookies?.length &&
      Date.now() - cachedPortal.fetchedAt < PORTAL_SESSION_TTL_MS
    ) {
      setPortalWebView({
        autoLogin: portalAutoLogin,
        cookies: cachedPortal.cookies,
        title: 'Twoja Uczelnia',
        url
      });
      return;
    }

    if (!email.trim() || !password) {
      Linking.openURL(url).catch(() => {});
      return;
    }

    setPortalWebView({ autoLogin: portalAutoLogin, loading: true, title: 'Twoja Uczelnia', url });

    try {
      const portalSession = await loginOnly({
        school: activeSchool,
        email: email.trim(),
        password,
        onPhase: () => {}
      });
      rememberPortalSession(activeSchool, portalSession.cookies || []);
      setPortalWebView({
        autoLogin: portalAutoLogin,
        cookies: portalSession.cookies || [],
        title: 'Twoja Uczelnia',
        url
      });
    } catch {
      if (portalAutoLogin) {
        setPortalWebView({
          autoLogin: portalAutoLogin,
          cookies: [],
          title: 'Twoja Uczelnia',
          url
        });
        return;
      }
      setPortalWebView(null);
      Linking.openURL(url).catch(() => {});
    }
  }, [email, openCdvPortal, password, rememberPortalSession, school]);

  const openBlackboardPortal = useCallback(() => {
    openCdvPortal({ target: 'blackboard', title: 'Blackboard', url: buildCdvBlackboardUrl(email) });
  }, [email, openCdvPortal]);

  function setWszipPdfSelection(uri) {
    const nextUri = String(uri || '').trim();
    wszipPdfUriRef.current = nextUri;
    setWszipPdfUri(nextUri);
    if (nextUri && school === SCHOOL_WSZIP) {
      setPassword(packWszipStoredCredential(nextUri));
    }
  }

  function setUsosIcalSelection(value) {
    const nextUrl = String(value || '').trim();
    usosIcalUrlRef.current = nextUrl;
    setUsosIcalUrl(nextUrl);
  }

  function setPollubPdfSelection(uriOrUris) {
    const nextUris = (Array.isArray(uriOrUris) ? uriOrUris : [uriOrUris])
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    pollubPdfUrisRef.current = nextUris;
    setPollubPdfUris(nextUris);
  }

  function applyDiscoveredPollubPdfUris(discoveredUris) {
    const incoming = (Array.isArray(discoveredUris) ? discoveredUris : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    if (!incoming.length) return;

    const merged = [...pollubPdfUrisRef.current];
    for (const uri of incoming) {
      if (!merged.includes(uri)) merged.push(uri);
    }
    setPollubPdfSelection(merged);
    void persistPollubPdfs(merged);
  }

  async function persistPollubPdfs(nextUris) {
    try {
      const packed = packPollubStoredCredential(password, nextUris);
      await secureSetItem(PASSWORD_KEY, packed, 'hasła');

      const id = profileIdFor(email, SCHOOL_POLLUB);
      const existing = savedProfiles.find((p) => p.id === id);
      if (existing) {
        await secureSetItem(profilePasswordKey(id), packed, 'hasła profilu');
      }
    } catch {
      // Nie blokuj UX — PDF-y są już w stanie aplikacji.
    }
  }

  async function persistWszipPdf(nextUri) {
    try {
      const packed = packWszipStoredCredential(nextUri);
      await secureSetItem(PASSWORD_KEY, packed, 'hasła');

      const id = profileIdFor(email, SCHOOL_WSZIP);
      const existing = savedProfiles.find((p) => p.id === id);
      if (existing) {
        await secureSetItem(profilePasswordKey(id), packed, 'hasła profilu');
      }
      setPassword(packed);
    } catch {
      // Nie blokuj UX — PDF jest już w stanie aplikacji.
    }
  }

  async function persistUsosCredentials(nextPassword = password, nextIcalUrl = usosIcalUrlRef.current, profileSnapshot = null) {
    try {
      const existing = unpackUsosStoredCredential(await secureGetItem(PASSWORD_KEY).catch(() => ''));
      const packed = packUsosStoredCredential(
        nextPassword,
        nextIcalUrl,
        profileSnapshot || existing?.profile || null
      );
      await secureSetItem(PASSWORD_KEY, packed, 'hasła');

      const id = profileIdFor(email, SCHOOL_USOS);
      const savedProfile = savedProfiles.find((p) => p.id === id);
      if (savedProfile) {
        await secureSetItem(profilePasswordKey(id), packed, 'hasła profilu');
      }
      setPassword(nextPassword);
    } catch {
      // Nie blokuj UX — iCal jest już w stanie aplikacji.
    }
  }

  async function addUsosIcalSelection(value) {
    const nextUrl = String(value || '').trim();
    setUsosIcalSelection(nextUrl);
    if (!nextUrl || !saved || school !== SCHOOL_USOS) return;

    await persistUsosCredentials(password, nextUrl);
    syncSemester({
      showLoader: true,
      notifyChanges: true,
      showErrors: true,
      forceStart: true
    }).catch(() => {});
  }

  async function commitUsosIcalSelection() {
    const nextUrl = usosIcalUrlRef.current;
    if (nextUrl && !looksLikeUsosIcalUrl(nextUrl)) {
      Alert.alert('Nieprawidłowy link iCal', 'Wklej prywatny link .ics z USOSweb zaczynający się od http lub https.');
      return;
    }
    if (!saved || school !== SCHOOL_USOS) return;
    await persistUsosCredentials(password, nextUrl);
    if (nextUrl && looksLikeUsosIcalUrl(nextUrl)) {
      syncSemester({
        showLoader: true,
        notifyChanges: true,
        showErrors: true,
        forceStart: true
      }).catch(() => {});
    }
  }

  function removeUsosIcalSelection() {
    setUsosIcalSelection('');
    if (saved && school === SCHOOL_USOS) {
      persistUsosCredentials(password, '');
      eventsRef.current = [];
      setEvents([]);
      setLastSync(null);
    }
  }

  async function addWszipPdfSelection(uri) {
    const nextUri = String(uri || '').trim();
    if (!nextUri) return;
    setWszipPdfSelection(nextUri);

    if (!saved || school !== SCHOOL_WSZIP) return;

    await persistWszipPdf(nextUri);
    const ok = await syncSemester({
      showLoader: true,
      notifyChanges: true,
      showErrors: true,
      forceStart: true
    });
    if (ok) {
      setWszipPdfManagerVisible(false);
    }
  }

  async function removeWszipPdfSelection() {
    setWszipPdfSelection('');
    if (saved && school === SCHOOL_WSZIP) {
      await persistWszipPdf('');
      eventsRef.current = [];
      setEvents([]);
      setLastSync(null);
      await writePlanCache(SCHOOL_WSZIP, email, {
        events: [],
        lastSync: '',
        semesterStartKey: semesterRange.startKey,
        semesterEndKey: semesterRange.endKey
      });
    }
  }

  async function addPollubPdfSelection(uri) {
    const nextUri = String(uri || '').trim();
    if (!nextUri) return;
    const next = [...pollubPdfUrisRef.current, nextUri];
    setPollubPdfSelection(next);

    if (!saved || school !== SCHOOL_POLLUB) return;

    await persistPollubPdfs(next);
    const ok = await syncSemester({
      showLoader: true,
      notifyChanges: true,
      showErrors: true,
      forceStart: true
    });
    if (ok) {
      setPollubPdfManagerVisible(false);
    }
  }

  function removePollubPdfSelection(uri) {
    const target = String(uri || '').trim();
    if (!target) return;
    const next = pollubPdfUrisRef.current.filter((item) => item !== target);
    setPollubPdfSelection(next);
    if (saved && school === SCHOOL_POLLUB) {
      persistPollubPdfs(next);
      syncSemester({ showLoader: true, notifyChanges: false, showErrors: true, forceStart: true }).catch(() => {});
    }
  }

  function updateEmail(value) {
    setEmail(value);
    const nextSchool = resolveSchoolForLogin(value, password);
    setSchool(nextSchool);
    if (nextSchool === SCHOOL_WSZIP && password && !looksLikeWszipPdfCredential(password) && !looksLikeWszipStoredCredential(password)) {
      setPassword('');
    }
    if (nextSchool === SCHOOL_WAT && password) {
      setPassword('');
    }
  }

  function updatePassword(value) {
    setPassword(value);
    setSchool(resolveSchoolForLogin(email, value));
  }

  function showUsosIcalHelp() {
    setUsosHelpVisible(true);
  }

  if (!fontsLoaded) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.appBg }}>
        <StatusBar style="light" />
        <View style={{ alignItems: 'center', flex: 1, justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      </SafeAreaView>
    );
  }

  async function restoreCredentialsAndCache() {
    const [storedEmail, storedPassword, storedSchool, storedTheme, storedRemember, storedCardVisibility, profiles] =
      await Promise.all([
      secureGetItem(EMAIL_KEY, 'loginu').catch(() => null),
      secureGetItem(PASSWORD_KEY, 'hasła').catch(() => null),
      AsyncStorage.getItem(SCHOOL_KEY),
      AsyncStorage.getItem(THEME_KEY),
      AsyncStorage.getItem(REMEMBER_PROFILE_KEY),
      AsyncStorage.getItem(CARD_VISIBILITY_KEY),
      readSavedProfiles()
    ]);
    const nextSchool = storedSchool || resolveSchoolForLogin(storedEmail, storedPassword);
    const cachedPlan = await readPlanCache(nextSchool, storedEmail);

    setSavedProfiles(profiles);
    if (storedRemember === 'false') setRememberProfile(false);
    if (storedTheme === 'dark' || storedTheme === 'light') {
      setThemeName(storedTheme);
    }
    setCardVisibility(parseCardVisibility(storedCardVisibility));
    setSchool(nextSchool);
    if (cachedPlan?.events?.length) {
      setEvents(cachedPlan.events);
      if (cachedPlan.lastSync) setLastSync(new Date(cachedPlan.lastSync));
      if (nextSchool === SCHOOL_WSZIP) {
        const focus = focusRangeForEvents(cachedPlan.events, new Date(), 'today');
        if (focus) {
          setAnchorDate(focus.anchorDate);
          setMode(focus.mode);
        }
      }
    }
    if (storedEmail) setEmail(storedEmail);
    if (storedPassword) {
      setPassword(storedPassword);
      if (looksLikeUsosStoredCredential(storedPassword) || looksLikeUsosIcalUrl(storedPassword)) {
        const stored = unpackUsosStoredCredential(storedPassword);
        if (stored?.password) setPassword(stored.password);
        if (stored?.icalUrl) {
          setUsosIcalSelection(stored.icalUrl);
          setUsosIcalInputVisible(true);
        }
      }
      if (looksLikeWszipPdfCredential(storedPassword) || looksLikeWszipStoredCredential(storedPassword)) {
        const stored = unpackWszipStoredCredential(storedPassword);
        setWszipPdfSelection(stored?.pdfUri || '');
      }
      if (looksLikePollubStoredCredential(storedPassword)) {
        const stored = unpackPollubStoredCredential(storedPassword);
        if (stored?.password) setPassword(stored.password);
        if (stored?.pdfUris?.length) setPollubPdfSelection(stored.pdfUris);
        else if (stored?.pdfUri) setPollubPdfSelection(stored.pdfUri);
      }
      if (looksLikeWatStoredCredential(storedPassword)) {
        const stored = unpackWatStoredCredential(storedPassword);
        if (stored?.password) setPassword(stored.password);
        if (stored?.facultyId) setWatFacultyId(stored.facultyId);
        if (stored?.groupCode) setWatSelectedGroup(stored.groupCode);
        if (stored?.groupHref) setWatSelectedGroupHref(stored.groupHref);
      }
      if (looksLikeWseitStoredCredential(storedPassword)) {
        const stored = unpackWseitStoredCredential(storedPassword);
        if (stored?.password) setPassword(stored.password);
        if (stored?.contextId) setWseitSelectedContextId(stored.contextId);
        if (stored?.contextLabel) setWseitSelectedContextLabel(stored.contextLabel);
      }
    }
    if (storedEmail && storedPassword) {
      setSaved(true);
      await loadStudentProfileForAccount(nextSchool, storedEmail, storedPassword);
      if (storedRemember !== 'false') {
        upsertSavedProfile({ login: storedEmail, password: storedPassword, school: nextSchool })
          .then(setSavedProfiles)
          .catch(() => {});
      }
    }
  }

  async function openWszipBrowser() {
    try {
      await openMoodleInBrowser();
    } catch (error) {
      Alert.alert('Nie udało się otworzyć Moodle', error.message || 'Spróbuj ponownie.');
    }
  }

  async function pickWszipPdf() {
    try {
      const uri = await pickWszipPdfFile();
      if (!uri) {
        Alert.alert('Anulowano', 'Nie wybrano pliku PDF.');
        return;
      }
      await addWszipPdfSelection(uri);
    } catch (error) {
      Alert.alert('Nie udało się wybrać pliku PDF', error.message || 'Spróbuj ponownie.');
    }
  }

  async function pickPollubPdf() {
    try {
      const uri = await pickPollubPdfFile();
      if (!uri) {
        Alert.alert('Anulowano', 'Nie wybrano pliku PDF.');
        return;
      }
      await addPollubPdfSelection(uri);
    } catch (error) {
      Alert.alert('Nie udało się wybrać pliku PDF', error.message || 'Spróbuj ponownie.');
    }
  }

  function resolveWszipPdfCredential(overrideCredential = '') {
    const overrideStored = unpackWszipStoredCredential(overrideCredential);
    if (overrideStored?.pdfUri) {
      return packWszipStoredCredential(overrideStored.pdfUri);
    }
    if (overrideCredential && looksLikeWszipPdfCredential(overrideCredential)) {
      return packWszipStoredCredential(unpackWszipPdfCredential(overrideCredential));
    }
    if (wszipPdfUriRef.current) {
      return packWszipStoredCredential(wszipPdfUriRef.current);
    }
    const stored = unpackWszipStoredCredential(password);
    if (stored?.pdfUri) {
      return packWszipStoredCredential(stored.pdfUri);
    }
    if (looksLikeWszipPdfCredential(password)) {
      return packWszipStoredCredential(unpackWszipPdfCredential(password));
    }
    return '';
  }

  async function saveCredentialsAndRefresh(pdfOverride = '') {
    const loginValue = email.trim();
    const resolvedSchool = resolveSchoolForLogin(loginValue, resolveWszipPdfCredential(pdfOverride) || password);
    const nextSchool = loginSchool === SCHOOL_WSZIP ? SCHOOL_WSZIP : resolvedSchool;
    const isUsos = nextSchool === SCHOOL_USOS;
    const isWszip = nextSchool === SCHOOL_WSZIP;
    const isPollub = nextSchool === SCHOOL_POLLUB;
    const isWat = nextSchool === SCHOOL_WAT;
    const isWseit = nextSchool === SCHOOL_WSEIT;
    const isMoodleLogin = isWszip;
    const activeCredential = resolveWszipPdfCredential(pdfOverride);
    const usosSecondFactorCodeSnapshot = usosSecondFactorCodeRef.current.trim();

    Keyboard.dismiss();

    if (!loginValue) {
      Alert.alert('Brak danych', isPollub ? 'Wpisz login do eHMS.' : 'Wpisz uczelniany e-mail.');
      return;
    }

    if (!nextSchool) {
      Alert.alert(
        'Nie rozpoznano uczelni',
        'Użyj e-maila uczelnianego albo loginu w formacie wymaganym przez Twoją uczelnię (np. 6 cyfr dla eHMS, litery + 6 cyfr dla Merito).'
      );
      return;
    }

    if (isPollub) {
      if (!password) {
        Alert.alert('Brak danych', 'Wpisz hasło do eHMS.');
        return;
      }
      // PDF jest opcjonalny (WBiA pobierze plan bez PDF; inne wydziały mogą go wymagać dopiero przy pobieraniu planu).
    } else if (isWat) {
      if (!watSelectedGroup) {
        setWatGroupPickerVisible(true);
        return;
      }
    } else if (isWseit) {
      if (!password) {
        Alert.alert('Brak danych', 'Wpisz hasło do WSEIT (zwykle data urodzenia).');
        return;
      }
      if (!wseitSelectedContextId) {
        setWseitContextPickerVisible(true);
        return;
      }
    } else if (!isMoodleLogin && !password) {
      Alert.alert(
        'Brak danych',
        isUsos
          ? 'Wpisz e-mail i hasło do USOSweb.'
          : 'Wpisz uczelniany e-mail i hasło.'
      );
      return;
    }

    const watSemester = watSemesterForDate();
    const loginPassword = isWszip
      ? activeCredential
      : isUsos
        ? packUsosStoredCredential(password, usosIcalUrlRef.current)
        : isWat
          ? packWatStoredCredential(password || '', {
              facultyId: watFacultyId,
              groupCode: watSelectedGroup,
              groupHref: watSelectedGroupHref,
              semesterFolder: watSemester.folder,
              semesterTerm: watSemester.term
            })
          : isWseit
            ? packWseitStoredCredential(password || '', {
                contextId: wseitSelectedContextId,
                contextLabel: wseitSelectedContextLabel
              })
            : password;

    syncInProgressRef.current = false;
    const attemptId = beginLoginAttempt();
    setLoading(true);
    setSyncing(false);
    setSchool(nextSchool);
    updateLoginPhase(`Loguję: ${schoolProfiles[nextSchool]?.subtitle || 'uczelnia'}`);

    let credentialsToSave = isWszip ? (activeCredential || packWszipStoredCredential('')) : loginPassword;
    if (isPollub) {
      credentialsToSave = packPollubStoredCredential(password, pollubPdfUrisRef.current);
    }

    try {
      if (isWszip && !activeCredential) {
        eventsRef.current = [];
        setEvents([]);
        setLastSync(null);
      } else {
        const scheduleResult = normalizeScheduleFetchResult(await loginAndFetchSchedule({
          school: nextSchool,
          email: loginValue,
          password: isPollub ? password : loginPassword,
          startDateKey: semesterRange.startKey,
          endDateKey: semesterRange.endKey,
          onCredentials: (credentials) => {
            credentialsToSave = credentials;
          },
          onPhase: updateLoginPhase,
          onStudentProfile: (autoPatch) => applyAutoStudentProfile(nextSchool, loginValue, autoPatch),
          extractPdfTextLocal,
          usosSecondFactorCode: isUsos ? usosSecondFactorCodeSnapshot : '',
          pollubPdfUri: pollubPdfUrisRef.current[0] || '',
          pollubPdfUris: pollubPdfUrisRef.current,
          watFacultyId,
          watGroupCode: watSelectedGroup,
          watGroupHref: watSelectedGroupHref,
          wseitContextId: wseitSelectedContextId,
          wseitContextLabel: wseitSelectedContextLabel
        }));
        if (!isLoginAttemptCurrent(attemptId)) return;
        const previousEvents = eventsRef.current;
        enrichSyncGenerationRef.current += 1;
        const syncGeneration = enrichSyncGenerationRef.current;
        cancelPendingEnrichFlush();
        enrichInProgressRef.current = false;

        const nextEvents = mergeScheduleWithExisting(previousEvents, scheduleResult.events);
        rememberPortalSession(nextSchool, scheduleResult.portalCookies);
        if (nextSchool === SCHOOL_POLLUB) {
          applyDiscoveredPollubPdfUris(scheduleResult.discoveredPollubPdfUris);
          credentialsToSave = packPollubStoredCredential(password, pollubPdfUrisRef.current);
        }
        if (nextSchool === SCHOOL_WSEIT) {
          credentialsToSave = packWseitStoredCredential(password, {
            contextId: wseitSelectedContextId,
            contextLabel: wseitSelectedContextLabel
          });
        }
        const syncedAt = new Date();

        eventsRef.current = nextEvents;
        setEvents(nextEvents);
        setLastSync(syncedAt);
        if (nextSchool === SCHOOL_WSZIP) {
          const focus = focusRangeForEvents(nextEvents, anchorDateRef.current, modeRef.current);
          if (focus) {
            setAnchorDate(focus.anchorDate);
            setMode(focus.mode);
          }
        }
        await writePlanCache(nextSchool, loginValue, {
          events: nextEvents,
          lastSync: syncedAt.toISOString(),
          semesterStartKey: semesterRange.startKey,
          semesterEndKey: semesterRange.endKey
        });
        if (scheduleResult.enrichDetails) {
          void enrichScheduleDetailsInBackground({
            activeSchool: nextSchool,
            enrichDetails: scheduleResult.enrichDetails,
            loginEmail: loginValue,
            syncGeneration
          });
        }
      }
    } catch (error) {
      if (!isLoginAttemptCurrent(attemptId) || isLoginCancelledError(error)) {
        setLoading(false);
        updateLoginPhase('');
        return;
      }
      if (error?.code === 'USOS_2FA_REQUIRED') {
        setUsosSecondFactorRequired(true);
        setLoading(false);
        updateLoginPhase('');
        return;
      }
      const phase = loginPhaseRef.current ? `Etap: ${loginPhaseRef.current}\n\n` : '';
      Alert.alert('Nie udało się wczytać planu', `${phase}${error.message || 'Dane logowania są nieprawidłowe.'}`);
      setLoading(false);
      updateLoginPhase('');
      return;
    }

    setEmail(loginValue);
    if (isPollub) {
      setPassword(password);
      setPollubPdfSelection(pollubPdfUrisRef.current);
    } else if (isUsos) {
      setPassword(password);
      setUsosIcalSelection(usosIcalUrlRef.current);
    } else {
      setPassword(credentialsToSave);
    }
    if (looksLikeUsosStoredCredential(credentialsToSave) || looksLikeUsosIcalUrl(credentialsToSave)) {
      const stored = unpackUsosStoredCredential(credentialsToSave);
      if (stored?.password) setPassword(stored.password);
      if (stored?.icalUrl) setUsosIcalSelection(stored.icalUrl);
    }
    if (looksLikeWszipPdfCredential(credentialsToSave) || looksLikeWszipStoredCredential(credentialsToSave)) {
      const stored = unpackWszipStoredCredential(credentialsToSave);
      setWszipPdfSelection(stored?.pdfUri || '');
    }
    if (looksLikePollubStoredCredential(credentialsToSave)) {
      const stored = unpackPollubStoredCredential(credentialsToSave);
      if (stored?.password) setPassword(stored.password);
      if (stored?.pdfUris?.length) setPollubPdfSelection(stored.pdfUris);
      else if (stored?.pdfUri) setPollubPdfSelection(stored.pdfUri);
    }
    setSchool(nextSchool);
    setSaved(true);
    await loadStudentProfileForAccount(nextSchool, loginValue, credentialsToSave);
    if (isUsos) {
      scheduleUsosSemesterBackgroundRefresh(loginValue, credentialsToSave);
    }

    updateLoginPhase('Zapisuję profil na telefonie');

    try {
      await AsyncStorage.setItem(REMEMBER_PROFILE_KEY, rememberProfile ? 'true' : 'false');
      if (rememberProfile) {
        await Promise.all([
          secureSetItem(EMAIL_KEY, loginValue, 'loginu'),
          secureSetItem(PASSWORD_KEY, credentialsToSave, 'hasła'),
          AsyncStorage.setItem(SCHOOL_KEY, nextSchool)
        ]);
        setSavedProfiles(await upsertSavedProfile({ login: loginValue, password: credentialsToSave, school: nextSchool }));
      } else {
        await Promise.all([
          secureDeleteItem(EMAIL_KEY, 'loginu'),
          secureDeleteItem(PASSWORD_KEY, 'hasła'),
          AsyncStorage.removeItem(SCHOOL_KEY)
        ]);
      }
    } catch (error) {
      Alert.alert('Zalogowano', error.message || 'Nie udało się zapisać profilu, ale aplikacja jest już otwarta.');
    } finally {
      setLoading(false);
      updateLoginPhase('');
    }
  }

  function confirmDeleteSavedProfile(profile) {
    setDeleteProfileConfirm(profile);
  }

  async function handleConfirmDeleteSavedProfile() {
    if (!deleteProfileConfirm) return;

    try {
      setSavedProfiles(await removeSavedProfile(deleteProfileConfirm.id));
      setDeleteProfileConfirm(null);
    } catch (error) {
      Alert.alert('Nie udało się usunąć konta', error.message || 'Spróbuj ponownie.');
    }
  }

  async function loginWithProfile(profile) {
    syncInProgressRef.current = false;
    const usosSecondFactorCodeSnapshot = usosSecondFactorCodeRef.current.trim();
    Keyboard.dismiss();
    setProfileLoginLoadingProfile(profile);
    const attemptId = beginLoginAttempt();
    setLoading(true);
    setSyncing(false);
    updateLoginPhase(`Odczytuję zapamiętany profil: ${profile.login}`);
    let profilePassword = '';
    try {
      profilePassword = await secureGetItem(profilePasswordKey(profile.id), 'hasła profilu');
    } catch (error) {
      setProfileLoginLoadingProfile(null);
      setLoading(false);
      updateLoginPhase('');
      Alert.alert('Profil wymaga ponownego logowania', error.message || 'Nie udało się odczytać zapisanego hasła.');
      return;
    }

    if (!profilePassword && profile.login.trim().toLowerCase() === email.trim().toLowerCase()) {
      profilePassword = await secureGetItem(PASSWORD_KEY, 'hasła aktywnego konta').catch(() => '');
    }

    if (!profilePassword) {
      setProfileLoginLoadingProfile(null);
      setLoading(false);
      updateLoginPhase('');
      Alert.alert('Profil wymaga ponownego logowania', 'Nie znaleziono zapisanego hasła dla tego profilu.');
      return;
    }

    setEmail(profile.login);
    setPassword(profilePassword);
    if (profile.school === SCHOOL_USOS && (looksLikeUsosStoredCredential(profilePassword) || looksLikeUsosIcalUrl(profilePassword))) {
      const stored = unpackUsosStoredCredential(profilePassword);
      if (stored?.password) setPassword(stored.password);
      setUsosIcalSelection(stored?.icalUrl || '');
      setUsosIcalInputVisible(Boolean(stored?.icalUrl));
    }
    if (profile.school === SCHOOL_WSZIP && (looksLikeWszipPdfCredential(profilePassword) || looksLikeWszipStoredCredential(profilePassword))) {
      const stored = unpackWszipStoredCredential(profilePassword);
      setWszipPdfSelection(stored?.pdfUri || '');
    }
    if (profile.school === SCHOOL_POLLUB && looksLikePollubStoredCredential(profilePassword)) {
      const stored = unpackPollubStoredCredential(profilePassword);
      if (stored?.password) setPassword(stored.password);
      if (stored?.pdfUris?.length) setPollubPdfSelection(stored.pdfUris);
      else if (stored?.pdfUri) setPollubPdfSelection(stored.pdfUri);
    }
    if (profile.school === SCHOOL_WAT && looksLikeWatStoredCredential(profilePassword)) {
      const stored = unpackWatStoredCredential(profilePassword);
      if (stored?.password) setPassword(stored.password);
      if (stored?.facultyId) setWatFacultyId(stored.facultyId);
      if (stored?.groupCode) setWatSelectedGroup(stored.groupCode);
      if (stored?.groupHref) setWatSelectedGroupHref(stored.groupHref);
    }
    if (profile.school === SCHOOL_WSEIT && looksLikeWseitStoredCredential(profilePassword)) {
      const stored = unpackWseitStoredCredential(profilePassword);
      if (stored?.password) setPassword(stored.password);
      if (stored?.contextId) setWseitSelectedContextId(stored.contextId);
      if (stored?.contextLabel) setWseitSelectedContextLabel(stored.contextLabel);
    }
    setSchool(profile.school);
    try {
      if (profile.school === SCHOOL_POLLUB) {
        const stored = unpackPollubStoredCredential(profilePassword);
        const pollubPass = stored?.password || profilePassword;
        if (!pollubPass) {
          setProfileLoginLoadingProfile(null);
          setLoading(false);
          updateLoginPhase('');
          Alert.alert(
            'Profil POLLUB wymaga danych',
            'Uzupełnij hasło eHMS.'
          );
          return;
        }
      }

      const pollubStored = profile.school === SCHOOL_POLLUB
        ? unpackPollubStoredCredential(profilePassword)
        : null;
      const wszipStored = profile.school === SCHOOL_WSZIP
        ? unpackWszipStoredCredential(profilePassword)
        : null;
      const usosStored = profile.school === SCHOOL_USOS
        ? unpackUsosStoredCredential(profilePassword)
        : null;
      const watStored = profile.school === SCHOOL_WAT
        ? unpackWatStoredCredential(profilePassword)
        : null;
      const wseitStored = profile.school === SCHOOL_WSEIT
        ? unpackWseitStoredCredential(profilePassword)
        : null;
      let credentialsToSave = profilePassword;

      if (profile.school === SCHOOL_WSZIP && !wszipStored?.pdfUri) {
        eventsRef.current = [];
        setEvents([]);
        setLastSync(null);
      } else {
        const scheduleResult = normalizeScheduleFetchResult(await loginAndFetchSchedule({
          school: profile.school,
          email: profile.login,
          password: profile.school === SCHOOL_USOS
            ? packUsosStoredCredential(usosStored?.password || '', usosStored?.icalUrl || '')
            : pollubStored?.password || profilePassword,
          startDateKey: semesterRange.startKey,
          endDateKey: semesterRange.endKey,
          onCredentials: (credentials) => {
            credentialsToSave = credentials;
          },
          onPhase: updateLoginPhase,
          onStudentProfile: (autoPatch) => applyAutoStudentProfile(profile.school, profile.login, autoPatch),
          extractPdfTextLocal,
          usosSecondFactorCode: profile.school === SCHOOL_USOS ? usosSecondFactorCodeSnapshot : '',
          pollubPdfUri: pollubPdfUrisRef.current[0] || pollubStored?.pdfUris?.[0] || pollubStored?.pdfUri || '',
          pollubPdfUris: pollubPdfUrisRef.current.length ? pollubPdfUrisRef.current : pollubStored?.pdfUris || [],
          watFacultyId: watStored?.facultyId || watFacultyIdRef.current,
          watGroupCode: watStored?.groupCode || watSelectedGroupRef.current,
          watGroupHref: watStored?.groupHref || watSelectedGroupHrefRef.current,
          wseitContextId: wseitStored?.contextId || wseitSelectedContextIdRef.current,
          wseitContextLabel: wseitStored?.contextLabel || wseitSelectedContextLabelRef.current
        }));
        if (!isLoginAttemptCurrent(attemptId)) return;
        const previousEvents = eventsRef.current;
        enrichSyncGenerationRef.current += 1;
        const syncGeneration = enrichSyncGenerationRef.current;
        cancelPendingEnrichFlush();
        enrichInProgressRef.current = false;

        const nextEvents = mergeScheduleWithExisting(previousEvents, scheduleResult.events);
        rememberPortalSession(profile.school, scheduleResult.portalCookies);
        if (profile.school === SCHOOL_WSEIT) {
          credentialsToSave = packWseitStoredCredential(
            wseitStored?.password || profilePassword,
            {
              contextId: wseitStored?.contextId || wseitSelectedContextIdRef.current,
              contextLabel: wseitStored?.contextLabel || wseitSelectedContextLabelRef.current
            }
          );
        }
        if (profile.school === SCHOOL_POLLUB) {
          applyDiscoveredPollubPdfUris(scheduleResult.discoveredPollubPdfUris);
          credentialsToSave = packPollubStoredCredential(
            pollubStored?.password || profilePassword,
            pollubPdfUrisRef.current
          );
        }
        const syncedAt = new Date();

        eventsRef.current = nextEvents;
        setEvents(nextEvents);
        setLastSync(syncedAt);
        if (profile.school === SCHOOL_WSZIP) {
          const focus = focusRangeForEvents(nextEvents, anchorDateRef.current, modeRef.current);
          if (focus) {
            setAnchorDate(focus.anchorDate);
            setMode(focus.mode);
          }
        }
        await writePlanCache(profile.school, profile.login, {
          events: nextEvents,
          lastSync: syncedAt.toISOString(),
          semesterStartKey: semesterRange.startKey,
          semesterEndKey: semesterRange.endKey
        });
        if (scheduleResult.enrichDetails) {
          void enrichScheduleDetailsInBackground({
            activeSchool: profile.school,
            enrichDetails: scheduleResult.enrichDetails,
            loginEmail: profile.login,
            syncGeneration
          });
        }
      }
      profilePassword = credentialsToSave;
    } catch (error) {
      if (!isLoginAttemptCurrent(attemptId) || isLoginCancelledError(error)) {
        setProfileLoginLoadingProfile(null);
        setLoading(false);
        updateLoginPhase('');
        return;
      }
      if (error?.code === 'USOS_2FA_REQUIRED') {
        setUsosSecondFactorRequired(true);
        setProfileLoginLoadingProfile(null);
        setLoading(false);
        updateLoginPhase('');
        return;
      }
      const phase = loginPhaseRef.current ? `Etap: ${loginPhaseRef.current}\n\n` : '';
      Alert.alert('Nie udało się wczytać planu', `${phase}${error.message || 'Dane logowania są nieprawidłowe.'}`);
      setProfileLoginLoadingProfile(null);
      setLoading(false);
      updateLoginPhase('');
      return;
    }

    setSaved(true);
    await loadStudentProfileForAccount(profile.school, profile.login);
    setLoading(false);
    updateLoginPhase('Zapisuję aktywny profil');

    try {
      await Promise.all([
        secureSetItem(EMAIL_KEY, profile.login, 'loginu'),
        secureSetItem(PASSWORD_KEY, profilePassword, 'hasła'),
        secureSetItem(profilePasswordKey(profile.id), profilePassword, 'hasła profilu'),
        AsyncStorage.setItem(SCHOOL_KEY, profile.school)
      ]);
    } catch (error) {
      Alert.alert('Plan pobrany', error.message || 'Nie udało się zapisać aktywnego profilu, ale plan jest już dostępny.');
    } finally {
      setProfileLoginLoadingProfile(null);
      setLoading(false);
      updateLoginPhase('');
    }
  }

  async function clearCredentials() {
    Promise.all([
      secureDeleteItem(EMAIL_KEY, 'loginu').catch(() => {}),
      secureDeleteItem(PASSWORD_KEY, 'hasła').catch(() => {}),
      AsyncStorage.removeItem(SCHOOL_KEY)
    ]);
    syncInProgressRef.current = false;
    setSettingsOpen(false);
    setLoading(false);
    setSyncing(false);
    updateLoginPhase('');
    setSaved(false);
    setPassword('');
    setWszipPdfSelection('');
    setPollubPdfSelection('');
    setUsosIcalSelection('');
    setUsosIcalInputVisible(false);
    setUsosIcalManagerVisible(false);
    setUsosSecondFactorCode('');
    setUsosSecondFactorRequired(false);
    setEvents([]);
    setLastSync(null);
    setMode('today');
    setAnchorDate(new Date());
    setStudentProfile(createEmptyStudentProfile());
  }

  async function toggleTheme() {
    const nextTheme = themeName === 'dark' ? 'light' : 'dark';
    setThemeName(nextTheme);
    await AsyncStorage.setItem(THEME_KEY, nextTheme);
  }

  function moveRange(direction) {
    const next = new Date(anchorDate);
    if (mode === 'today') next.setDate(next.getDate() + direction);
    if (mode === 'month') next.setMonth(next.getMonth() + direction);
    setAnchorDate(next);
  }

  function goToToday() {
    setMode('today');
    setAnchorDate(new Date());
  }

  function goToTomorrow() {
    setMode('today');
    setAnchorDate(addDays(new Date(), 1));
  }

  function goToPlanDates() {
    const focus = nearestUpcomingEventFocus(events);
    if (!focus) return;
    setAnchorDate(focus.anchorDate);
    setMode(focus.mode);
  }

  const todayKey = toDateKey(new Date());
  const tomorrowKey = toDateKey(addDays(new Date(), 1));
  const anchorKey = toDateKey(anchorDate);
  const isTodaySelected = mode === 'today' && anchorKey === todayKey;
  const isTomorrowSelected = mode === 'today' && anchorKey === tomorrowKey;

  const days = daysBetween(range.start, range.end);
  const pdfPlansSchoolLabel = school === SCHOOL_WSZIP ? 'WSZiP' : 'POLLUB';
  const showPdfPlansManager = school === SCHOOL_WSZIP || school === SCHOOL_POLLUB;
  const showIcalPlansManager = school === SCHOOL_USOS;
  const icalPlansSchoolLabel = usosPlanLabelForLogin(email);
  const showBlackboardPortal = school === SCHOOL_CDV && /@edu\.cdv\.pl$/i.test(email.trim());

  return (
    <SettingsShell
      drawer={(
        <SettingsDrawer
          cardVisibility={cardVisibility}
          onLogout={clearCredentials}
          onManageIcalPlans={() => setUsosIcalManagerVisible(true)}
          onManagePdfPlans={() => {
            if (school === SCHOOL_WSZIP) setWszipPdfManagerVisible(true);
            else setPollubPdfManagerVisible(true);
          }}
          onOpenBlackboardPortal={openBlackboardPortal}
          onOpenUniversityPortal={openUniversityPortal}
          onToggleCardVisibility={toggleCardVisibility}
          onToggleTheme={toggleTheme}
          icalPlansSchoolLabel={icalPlansSchoolLabel}
          pdfPlansSchoolLabel={pdfPlansSchoolLabel}
          showIcalPlansManager={showIcalPlansManager}
          showBlackboardPortal={showBlackboardPortal}
          showPdfPlansManager={showPdfPlansManager}
          studentProfile={studentProfile}
          theme={theme}
          themeName={themeName}
        />
      )}
      drawerBackgroundColor={theme.screenBg}
      edgeSwipeEnabled={saved}
      onClose={() => setSettingsOpen(false)}
      onOpen={() => setSettingsOpen(true)}
      open={settingsOpen}
    >
      <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <LinearGradient
        colors={['#050505', '#101036', '#062f37', '#050505']}
        end={{ x: 1, y: 0 }}
        locations={[0, 0.24, 0.48, 1]}
        start={{ x: 0, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerTop}>
          <View style={styles.headerBrand}>
            <Image source={APP_ICON} style={styles.headerLogo} resizeMode="contain" />
            <AnimatedHeaderTitle isTomorrow={saved && isTomorrowSelected} styles={styles} />
          </View>
          {saved ? (
            <Pressable
              accessibilityLabel={monthSliderOpen ? 'Zwiń wybór miesiąca' : 'Rozwiń wybór miesiąca'}
              hitSlop={8}
              onPress={() => setMonthSliderOpen((open) => !open)}
              style={styles.headerMonthToggle}
            >
              <Ionicons color="#ffffff" name={monthSliderOpen ? 'chevron-up' : 'chevron-down'} size={24} />
            </Pressable>
          ) : null}
          {saved ? (
            <Pressable accessibilityLabel="Ustawienia" hitSlop={8} style={styles.settingsButton} onPress={() => setSettingsOpen(true)}>
              <Ionicons color="#ffffff" name="person-outline" size={28} />
            </Pressable>
          ) : null}
        </View>
      </LinearGradient>

      {saved ? (
        <View style={styles.scheduleScreen}>
          <View style={styles.scheduleControls}>
            <View style={styles.toolbar}>
              <View style={styles.toolbarRange}>
                {monthSliderOpen ? (
                  <MonthSlider
                    anchorDate={anchorDate}
                    items={monthSliderItems}
                    onSelectMonth={selectMonth}
                    open={monthSliderOpen}
                    styles={styles}
                  />
                ) : null}

                <ToolbarRangeTitle
                  styles={styles}
                  text={range.title}
                />

                <View style={styles.quickDayRow}>
                  <Pressable
                    accessibilityLabel="Poprzedni"
                    onPress={() => moveRange(-1)}
                    style={styles.navArrowSlot}
                  >
                    <Ionicons color={theme.mutedText} name="chevron-back" size={24} />
                  </Pressable>
                  <View style={styles.quickDayCenter}>
                    <BrandPillButton
                      active={isTodaySelected}
                      activeTextStyle={styles.quickDayButtonTextActive}
                      label="Dziś"
                      onPress={goToToday}
                      style={styles.quickDayButton}
                      textStyle={styles.quickDayButtonText}
                    />
                    <BrandPillButton
                      active={isTomorrowSelected}
                      activeTextStyle={styles.quickDayButtonTextActive}
                      label="Jutro"
                      onPress={goToTomorrow}
                      style={styles.quickDayButton}
                      textStyle={styles.quickDayButtonText}
                    />
                  </View>
                  <Pressable
                    accessibilityLabel="Następny"
                    onPress={() => moveRange(1)}
                    style={styles.navArrowSlot}
                  >
                    <Ionicons color={theme.mutedText} name="chevron-forward" size={24} />
                  </Pressable>
                </View>
              </View>
            </View>

            {lastSync ? (
              <Text style={styles.syncText}>
                Dane zapisane: {new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(lastSync)}
                {syncing ? ' • aktualizuję w tle' : ''}
              </Text>
            ) : null}
          </View>

          <ScrollView
            key={`schedule-${events.length}-${lastSync ? lastSync.getTime() : 0}`}
            style={styles.scheduleList}
            contentContainerStyle={styles.scheduleListContent}
          >
            {loading ? (
              <View style={styles.loadingPanel}>
                <ActivityIndicator color={theme.accent} />
                <Text style={styles.loadingText}>{loginPhase || 'Pobieram plan semestru...'}</Text>
              </View>
            ) : null}

            {visibleEvents.length === 0 && !loading ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>Brak zajęć w tym zakresie</Text>
                {events.length > 0 ? (
                  <>
                    <Text style={styles.emptyHint}>
                      Plan zawiera {events.length} terminów w innych datach.
                    </Text>
                    <BrandPillButton
                      label="Przejdź do planu"
                      onPress={goToPlanDates}
                      style={styles.emptyAction}
                      textStyle={styles.emptyActionText}
                    />
                  </>
                ) : null}
              </View>
            ) : null}

            {days.map((day) => {
              const key = toDateKey(day);
              const dayEvents = groupedEvents[key] || [];
              if (mode === 'month' && dayEvents.length === 0) return null;

              return (
                <View style={styles.daySection} key={key}>
                  <Text style={styles.dayTitle}>{dateLabel(day)}</Text>
                  {dayEvents.length === 0 ? (
                    <Text style={styles.noClasses}>Brak zajęć</Text>
                  ) : (
                    dayEvents.map((event) => (
                      <ClassCard
                        cardVisibility={cardVisibility}
                        event={event}
                        key={eventIdentity(event)}
                        styles={styles}
                      />
                    ))
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : profileLoginLoadingProfile ? (
        <SavedProfileLoadingScreen
          profile={profileLoginLoadingProfile}
          styles={styles}
          themeName={themeName}
        />
      ) : (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          <>
            <View style={styles.loginPanel}>
              <Text style={styles.sectionTitle}>Logowanie</Text>
              {email.trim() && detectedSchool ? (
                <Text style={styles.detectedSchoolText}>
                  Wykryto uczelnię: {detectedSchoolLabelForLogin(email, detectedSchool)}
                </Text>
              ) : null}
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                cursorColor={theme.formFocus}
                keyboardType={loginKeyboardType}
                onBlur={() => setFocusedField(null)}
                onChangeText={updateEmail}
                onFocus={() => setFocusedField('email')}
                placeholder={profile.loginPlaceholder}
                placeholderTextColor={theme.mutedText}
                selectionColor={theme.formFocus}
                style={[styles.input, focusedField === 'email' && styles.inputFocused]}
                value={email}
              />
              {isWszipLogin ? (
                <Pressable style={styles.rememberRow} onPress={() => setRememberProfile((value) => !value)}>
                  {({ pressed }) => (
                    <>
                      <View style={[styles.checkbox, rememberProfile && styles.checkboxActive, pressed && styles.checkboxPressed]}>
                        {rememberProfile ? <Ionicons color={theme.checkboxCheck} name="checkmark" size={15} /> : null}
                      </View>
                      <Text style={styles.rememberText}>Zapamiętaj profil</Text>
                    </>
                  )}
                </Pressable>
              ) : null}
              {isWszipLogin ? (
                <View style={styles.wszipFlow}>
                  <Text style={styles.wszipSessionHint}>
                    Moodle WSZiP wymaga logowania Google w przeglądarce. Aplikacja nie może pobrać planu
                    automatycznie i nie potrzebuje hasła. Zapisz profil teraz, a PDF planu możesz dodać od razu albo później w ustawieniach.
                  </Text>
                  <Pressable
                    disabled={loading}
                    onPress={openWszipBrowser}
                    style={({ pressed }) => [
                      styles.loginOptionalButton,
                      pressed && styles.loginOptionalButtonPressed,
                      loading && styles.primaryButtonDisabled
                    ]}
                  >
                    <Text style={styles.loginOptionalButtonText}>Otwórz Moodle (Google)</Text>
                  </Pressable>
                  <Pressable
                    disabled={loading}
                    onPress={pickWszipPdf}
                    style={({ pressed }) => [
                      styles.loginOptionalButton,
                      pressed && styles.loginOptionalButtonPressed,
                      loading && styles.primaryButtonDisabled
                    ]}
                  >
                    <Text style={styles.loginOptionalButtonText}>Dodaj PDF planu (opcjonalnie)</Text>
                  </Pressable>
                  {hasWszipPdf ? (
                    <Text style={styles.wszipPdfSelected}>
                      Wybrany plik: {wszipPdfLabel(wszipPdfUri)}
                    </Text>
                  ) : null}
                  <Pressable
                    accessibilityLabel="Instrukcja pobierania PDF z Moodle"
                    onPress={() => setWszipHelpVisible(true)}
                    style={styles.wszipHelpLink}
                  >
                    <Ionicons color={theme.formFocus} name="information-circle-outline" size={18} />
                    <Text style={styles.wszipHelpLinkText}>Jak pobrać PDF z Moodle?</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  {isPollubLogin ? (
                    <Text style={styles.pollubSessionHint}>
                      Zaloguj się do eHMS (login + hasło). PDF planu jest opcjonalny — możesz dodać go teraz lub później w ustawieniach.
                    </Text>
                  ) : null}
                  {isWseitLogin ? (
                    <Text style={styles.pollubSessionHint}>
                      Zaloguj się do wd.wseit.pl (login + hasło, zwykle data urodzenia). Jeśli masz kilka kierunków, wybierz właściwy profil studiów.
                    </Text>
                  ) : null}
                  {!isWatLogin ? (
                    <View style={styles.passwordRow}>
                      <TextInput
                        cursorColor={theme.formFocus}
                        onBlur={() => setFocusedField(null)}
                        onChangeText={updatePassword}
                        onFocus={() => setFocusedField('password')}
                        placeholder={
                          isUsosLogin
                            ? 'Hasło do USOSweb'
                            : isPollubLogin
                              ? 'Hasło do eHMS'
                              : isWseitLogin
                                ? 'Hasło do WSEIT (np. data urodzenia)'
                                : 'Hasło'
                        }
                        placeholderTextColor={theme.mutedText}
                        secureTextEntry={!passwordVisible}
                        selectionColor={theme.formFocus}
                        style={[styles.input, styles.passwordInput, focusedField === 'password' && styles.inputFocused]}
                        value={password}
                      />
                      <Pressable
                        accessibilityLabel={passwordVisible ? 'Ukryj hasło' : 'Pokaż hasło'}
                        onPress={() => setPasswordVisible((visible) => !visible)}
                        style={styles.passwordToggle}
                      >
                        <Ionicons color={theme.passwordIcon} name={passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={22} />
                      </Pressable>
                    </View>
                  ) : null}
                  <Pressable style={styles.rememberRow} onPress={() => setRememberProfile((value) => !value)}>
                    {({ pressed }) => (
                      <>
                        <View style={[styles.checkbox, rememberProfile && styles.checkboxActive, pressed && styles.checkboxPressed]}>
                          {rememberProfile ? <Ionicons color={theme.checkboxCheck} name="checkmark" size={15} /> : null}
                        </View>
                        <Text style={styles.rememberText}>Zapamiętaj profil</Text>
                      </>
                    )}
                  </Pressable>
                  {isWatLogin ? (
                    <View style={styles.watFlow}>
                      <Text style={styles.pollubSessionHint}>
                        Grupy i plany pobieramy ze strony WML (wml.wat.edu.pl/rozklady-zajec) — wystarczy e-mail i wybór grupy.
                      </Text>
                      {watSelectedGroup ? (
                        <Text style={styles.watSelectedGroupText}>Wybrana grupa: {watSelectedGroup}</Text>
                      ) : null}
                      <Pressable
                        disabled={loading}
                        onPress={() => setWatGroupPickerVisible(true)}
                        style={({ pressed }) => [
                          styles.loginOptionalButton,
                          pressed && styles.loginOptionalButtonPressed,
                          loading && styles.primaryButtonDisabled
                        ]}
                      >
                        <Text style={styles.loginOptionalButtonText}>
                          {watSelectedGroup ? 'Zmień grupę' : 'Wybierz grupę'}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {isWseitLogin ? (
                    <View style={styles.watFlow}>
                      {wseitSelectedContextLabel ? (
                        <Text style={styles.watSelectedGroupText}>
                          Wybrany profil: {wseitSelectedContextLabel}
                        </Text>
                      ) : null}
                      <Pressable
                        disabled={loading || !password}
                        onPress={() => setWseitContextPickerVisible(true)}
                        style={({ pressed }) => [
                          styles.loginOptionalButton,
                          pressed && styles.loginOptionalButtonPressed,
                          (loading || !password) && styles.primaryButtonDisabled
                        ]}
                      >
                        <Text style={styles.loginOptionalButtonText}>
                          {wseitSelectedContextId ? 'Zmień profil studiów' : 'Wybierz profil studiów'}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {isUsosLogin ? (
                    <View style={styles.pollubFlow}>
                      <Text style={styles.pollubSessionHint}>
                        Aplikacja zaloguje się do USOSweb lokalnie i spróbuje automatycznie pobrać link iCal. Ręczne dodanie linku iCal to opcja zapasowa, gdy automatyczne logowanie nie zadziała.
                      </Text>
                      {usosSecondFactorRequired ? (
                        <>
                          <Text style={styles.pollubSessionHint}>
                            Wpisz kod z e-mail lub SMS i kliknij „Zaloguj” ponownie — aplikacja dokończy logowanie (kod ważny kilka minut).
                          </Text>
                          <TextInput
                            autoCapitalize="none"
                            autoComplete="sms-otp"
                            autoCorrect={false}
                            blurOnSubmit
                            cursorColor={theme.formFocus}
                            editable={!loading}
                            keyboardType="number-pad"
                            onBlur={() => setFocusedField(null)}
                            onChangeText={updateUsosSecondFactorCode}
                            onFocus={() => setFocusedField('usosSecondFactor')}
                            onSubmitEditing={saveCredentialsAndRefresh}
                            placeholder="Kod e-mail / SMS z USOS"
                            placeholderTextColor={theme.mutedText}
                            returnKeyType="done"
                            selectionColor={theme.formFocus}
                            style={[styles.input, focusedField === 'usosSecondFactor' && styles.inputFocused]}
                            textContentType="oneTimeCode"
                            value={usosSecondFactorCode}
                          />
                        </>
                      ) : null}
                      <Pressable
                        accessibilityLabel={usosIcalInputVisible ? 'Zwiń sekcję linku iCal' : 'Rozwiń sekcję linku iCal'}
                        disabled={loading}
                        onPress={() => setUsosIcalInputVisible((open) => !open)}
                        style={[styles.usosIcalAccordionTrigger, loading && styles.primaryButtonDisabled]}
                      >
                        <Text
                          style={[
                            styles.loginOptionalButtonText,
                            styles.loginOptionalButtonTextRow,
                            usosIcalInputVisible && styles.loginOptionalButtonTextOpen
                          ]}
                        >
                          Dodaj link iCal (.ics) z USOSweb
                          {hasUsosIcal ? ' · dodano' : ''}
                        </Text>
                        <Ionicons
                          color={usosIcalInputVisible ? theme.text : theme.mutedText}
                          name={usosIcalInputVisible ? 'chevron-up' : 'chevron-down'}
                          size={20}
                        />
                      </Pressable>
                      {usosIcalInputVisible ? (
                        <View style={styles.usosIcalAccordionBody}>
                          <View style={styles.usosIcalBox}>
                            <TextInput
                              autoCapitalize="none"
                              autoCorrect={false}
                              cursorColor={theme.formFocus}
                              keyboardType="url"
                              onBlur={() => {
                                setFocusedField(null);
                                commitUsosIcalSelection();
                              }}
                              onChangeText={setUsosIcalSelection}
                              onFocus={() => setFocusedField('usosIcal')}
                              placeholder="Wklej prywatny link .ics z USOSweb"
                              placeholderTextColor={theme.mutedText}
                              selectionColor={theme.formFocus}
                              style={[styles.input, styles.usosIcalInput, focusedField === 'usosIcal' && styles.inputFocused]}
                              value={usosIcalUrl}
                            />
                            {hasUsosIcal ? (
                              <Pressable
                                accessibilityLabel="Usuń link iCal"
                                hitSlop={8}
                                onPress={removeUsosIcalSelection}
                                style={styles.pollubPdfRemove}
                              >
                                <Ionicons color={theme.mutedText} name="close-circle-outline" size={20} />
                              </Pressable>
                            ) : null}
                          </View>
                          <Pressable
                            accessibilityLabel="Jak pobrać link iCal z USOS"
                            onPress={showUsosIcalHelp}
                            style={styles.pollubHelpLink}
                          >
                            <Ionicons color={theme.formFocus} name="information-circle-outline" size={18} />
                            <Text style={styles.pollubHelpLinkText}>Jak pobrać link iCal?</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  {isPollubLogin ? (
                    <View style={styles.pollubFlow}>
                      <Pressable
                        disabled={loading}
                        onPress={pickPollubPdf}
                        style={({ pressed }) => [
                          styles.loginOptionalButton,
                          pressed && styles.loginOptionalButtonPressed,
                          loading && styles.primaryButtonDisabled
                        ]}
                      >
                        <Text style={styles.loginOptionalButtonText}>Dodaj PDF planu (opcjonalnie)</Text>
                      </Pressable>
                      {hasPollubPdf ? (
                        <View style={styles.pollubPdfList}>
                          {pollubPdfUris.map((uri) => (
                            <View key={uri} style={styles.pollubPdfRow}>
                              <Text numberOfLines={1} style={styles.pollubPdfSelected}>
                                {pollubPdfLabel(uri)}
                              </Text>
                              <Pressable
                                accessibilityLabel="Usuń PDF"
                                hitSlop={8}
                                onPress={() => removePollubPdfSelection(uri)}
                                style={styles.pollubPdfRemove}
                              >
                                <Ionicons color={theme.mutedText} name="close-circle-outline" size={20} />
                              </Pressable>
                            </View>
                          ))}
                        </View>
                      ) : null}
                      <Pressable
                        accessibilityLabel="Instrukcja planu POLLUB"
                        onPress={() => setPollubHelpVisible(true)}
                        style={styles.pollubHelpLink}
                      >
                        <Ionicons color={theme.formFocus} name="information-circle-outline" size={18} />
                        <Text style={styles.pollubHelpLinkText}>Jak pobrać plan i grupy?</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </>
              )}
              <View style={styles.primaryButtonRow}>
                <Pressable
                  disabled={loading}
                  onPress={saveCredentialsAndRefresh}
                  style={[styles.primaryButton, styles.primaryButtonFlex, loading && styles.primaryButtonDisabled]}
                >
                  <LinearGradient
                    colors={BRAND_GRADIENT}
                    end={BRAND_GRADIENT_END}
                    start={BRAND_GRADIENT_START}
                    style={styles.primaryButtonGradient}
                  >
                    {loading ? (
                      <View style={styles.primaryButtonLoading}>
                        <ActivityIndicator color={theme.text} />
                        <Text style={styles.primaryButtonLoadingText}>{loginPhase || 'Logowanie...'}</Text>
                      </View>
                    ) : (
                      <Text style={styles.primaryButtonText}>
                        Zaloguj
                      </Text>
                    )}
                  </LinearGradient>
                </Pressable>
                {loading ? (
                  <Pressable
                    accessibilityLabel="Anuluj logowanie"
                    hitSlop={8}
                    onPress={cancelActiveLogin}
                    style={({ pressed }) => [styles.loginCancelButton, pressed && styles.loginCancelButtonPressed]}
                  >
                    <Ionicons color={theme.text} name="close" size={24} />
                  </Pressable>
                ) : null}
              </View>
              {loginPhase ? <Text style={styles.loginPhaseText}>{loginPhase}</Text> : null}
              {savedProfiles.length ? (
                <View style={styles.savedProfiles}>
                  <Text style={styles.savedProfilesTitle}>Zapamiętane konta</Text>
                  {savedProfiles.map((savedProfile) => (
                    <SavedProfileButton
                      key={savedProfile.id}
                      loading={loading}
                      onPress={() => loginWithProfile(savedProfile)}
                      onRemove={() => confirmDeleteSavedProfile(savedProfile)}
                      savedProfile={savedProfile}
                      styles={styles}
                      theme={theme}
                    />
                  ))}
                </View>
              ) : null}
            </View>
            <StudioBrandFooter styles={styles} />
          </>
        </ScrollView>
      )}
    </SafeAreaView>
      <DeleteSavedProfileModal
        login={deleteProfileConfirm?.login}
        onCancel={() => setDeleteProfileConfirm(null)}
        onConfirm={handleConfirmDeleteSavedProfile}
        theme={theme}
        visible={Boolean(deleteProfileConfirm)}
      />
      <UniversityPortalModal
        autoLogin={portalWebView?.autoLogin}
        cookies={portalWebView?.cookies}
        loading={Boolean(portalWebView?.loading)}
        onClose={() => setPortalWebView(null)}
        theme={theme}
        title={portalWebView?.title}
        url={portalWebView?.url}
        visible={Boolean(portalWebView)}
      />
      <UsosIcalHelpModal
        onClose={() => setUsosHelpVisible(false)}
        theme={theme}
        visible={usosHelpVisible}
      />
      <UsosIcalManagerModal
        icalUrl={usosIcalUrl}
        onChangeIcalUrl={setUsosIcalSelection}
        onClose={() => setUsosIcalManagerVisible(false)}
        onHelp={showUsosIcalHelp}
        onRemove={removeUsosIcalSelection}
        onSave={async () => {
          await commitUsosIcalSelection();
          setUsosIcalManagerVisible(false);
        }}
        schoolLabel={icalPlansSchoolLabel}
        theme={theme}
        visible={usosIcalManagerVisible}
      />
      <WszipHelpModal
        onClose={() => setWszipHelpVisible(false)}
        theme={theme}
        visible={wszipHelpVisible}
      />
      <PollubHelpModal
        onClose={() => setPollubHelpVisible(false)}
        theme={theme}
        visible={pollubHelpVisible}
      />
      <WatGroupPickerModal
        groupFilter={watGroupFilter}
        groups={filteredWatGroups}
        groupsError={watGroupsError}
        groupsLoading={watGroupsLoading}
        onClose={closeWatGroupPicker}
        onConfirm={confirmWatGroupPicker}
        onGroupFilterChange={setWatGroupFilter}
        onSelectGroup={handleWatGroupSelect}
        selectedGroup={watSelectedGroup}
        theme={theme}
        visible={watGroupPickerVisible && isWatLogin}
      />
      <WseitContextPickerModal
        contextFilter={wseitContextFilter}
        contexts={filteredWseitContexts}
        contextsError={wseitContextsError}
        contextsLoading={wseitContextsLoading}
        onClose={closeWseitContextPicker}
        onConfirm={confirmWseitContextPicker}
        onContextFilterChange={setWseitContextFilter}
        onSelectContext={handleWseitContextSelect}
        selectedContextId={wseitSelectedContextId}
        theme={theme}
        visible={wseitContextPickerVisible && isWseitLogin}
      />
      <PollubPdfManagerModal
        onAddPdf={pickPollubPdf}
        onClose={() => setPollubPdfManagerVisible(false)}
        onRemovePdf={removePollubPdfSelection}
        pdfUris={pollubPdfUris}
        theme={theme}
        visible={pollubPdfManagerVisible}
      />
      <PollubPdfManagerModal
        emptyText="Nie dodano jeszcze PDF planu WSZiP."
        labelPdf={wszipPdfLabel}
        onAddPdf={pickWszipPdf}
        onClose={() => setWszipPdfManagerVisible(false)}
        onRemovePdf={removeWszipPdfSelection}
        pdfUris={wszipPdfUri ? [wszipPdfUri] : []}
        subtitle="PDF jest opcjonalny i można go podmienić w dowolnym momencie"
        theme={theme}
        title="PDF planów (WSZiP)"
        visible={wszipPdfManagerVisible}
      />
    </SettingsShell>
  );
}

function DeleteSavedProfileModal({ login, onCancel, onConfirm, theme, visible }) {
  const modalStyles = useMemo(() => createUsosIcalManagerStyles(theme), [theme]);

  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <View style={modalStyles.scrim}>
        <View style={modalStyles.panel}>
          <View style={modalStyles.header}>
            <LinearGradient
              colors={BRAND_GRADIENT}
              end={BRAND_GRADIENT_END}
              start={BRAND_GRADIENT_START}
              style={modalStyles.iconWrap}
            >
              <Ionicons color={BRAND_GRADIENT_TEXT} name="person-remove-outline" size={22} />
            </LinearGradient>
            <View style={modalStyles.titleBlock}>
              <Text style={modalStyles.title}>Usuń konto</Text>
              {login ? <Text style={modalStyles.subtitle}>{login}</Text> : null}
            </View>
          </View>

          <Text style={modalStyles.confirmText}>
            Czy na pewno chcesz usunąć to konto z listy zapamiętanych kont?
          </Text>

          <View style={modalStyles.footer}>
            <Pressable onPress={onCancel} style={modalStyles.secondaryButton}>
              <Text style={modalStyles.secondaryButtonText}>Nie</Text>
            </Pressable>
            <Pressable onPress={onConfirm} style={modalStyles.primaryButton}>
              <LinearGradient
                colors={BRAND_GRADIENT}
                end={BRAND_GRADIENT_END}
                start={BRAND_GRADIENT_START}
                style={modalStyles.primaryGradient}
              >
                <Text style={modalStyles.primaryText}>Tak</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function UsosIcalHelpModal({ onClose, theme, visible }) {
  const modalStyles = useMemo(() => createUsosIcalHelpStyles(theme), [theme]);
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={modalStyles.scrim}>
        <View style={modalStyles.panel}>
          <View style={modalStyles.header}>
            <LinearGradient
              colors={BRAND_GRADIENT}
              end={BRAND_GRADIENT_END}
              start={BRAND_GRADIENT_START}
              style={modalStyles.iconWrap}
            >
              <Ionicons color={BRAND_GRADIENT_TEXT} name="calendar-outline" size={22} />
            </LinearGradient>
            <View style={modalStyles.titleBlock}>
              <Text style={modalStyles.title}>Link iCal z USOS</Text>
              <Text style={modalStyles.subtitle}>Jak go pobrać i dodać</Text>
            </View>
            <Pressable accessibilityLabel="Zamknij instrukcję" hitSlop={8} onPress={onClose} style={modalStyles.closeButton}>
              <Ionicons color={theme.text} name="close" size={22} />
            </Pressable>
          </View>

          <View style={modalStyles.steps}>
            {USOS_ICAL_HELP_STEPS.map((step, index) => (
              <View key={step} style={modalStyles.stepRow}>
                <LinearGradient
                  colors={BRAND_GRADIENT}
                  end={BRAND_GRADIENT_END}
                  start={BRAND_GRADIENT_START}
                  style={modalStyles.stepNumber}
                >
                  <Text style={modalStyles.stepNumberText}>{index + 1}</Text>
                </LinearGradient>
                <Text style={modalStyles.stepText}>{step}</Text>
              </View>
            ))}
          </View>

          <Pressable onPress={onClose} style={modalStyles.actionButton}>
            <LinearGradient
              colors={BRAND_GRADIENT}
              end={BRAND_GRADIENT_END}
              start={BRAND_GRADIENT_START}
              style={modalStyles.actionGradient}
            >
              <Text style={modalStyles.actionText}>Rozumiem</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function UsosIcalManagerModal({
  icalUrl,
  onChangeIcalUrl,
  onClose,
  onHelp,
  onRemove,
  onSave,
  schoolLabel,
  theme,
  visible
}) {
  const modalStyles = useMemo(() => createUsosIcalManagerStyles(theme), [theme]);

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={modalStyles.scrim}>
        <View style={modalStyles.panel}>
          <View style={modalStyles.header}>
            <LinearGradient
              colors={BRAND_GRADIENT}
              end={BRAND_GRADIENT_END}
              start={BRAND_GRADIENT_START}
              style={modalStyles.iconWrap}
            >
              <Ionicons color={BRAND_GRADIENT_TEXT} name="calendar-outline" size={22} />
            </LinearGradient>
            <View style={modalStyles.titleBlock}>
              <Text style={modalStyles.title}>iCal planów ({schoolLabel})</Text>
              <Text style={modalStyles.subtitle}>Wklej prywatny link .ics z USOSweb</Text>
            </View>
            <Pressable accessibilityLabel="Zamknij" hitSlop={8} onPress={onClose} style={modalStyles.closeButton}>
              <Ionicons color={theme.text} name="close" size={22} />
            </Pressable>
          </View>

          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            cursorColor={theme.formFocus}
            keyboardType="url"
            onChangeText={onChangeIcalUrl}
            placeholder="https://.../plan.ics"
            placeholderTextColor={theme.mutedText}
            selectionColor={theme.formFocus}
            style={modalStyles.input}
            value={icalUrl}
          />

          <Pressable onPress={onHelp} style={modalStyles.helpLink}>
            <Ionicons color={theme.formFocus} name="information-circle-outline" size={18} />
            <Text style={modalStyles.helpText}>Jak pobrać link iCal?</Text>
          </Pressable>

          <View style={modalStyles.footer}>
            <Pressable onPress={onRemove} style={modalStyles.secondaryButton}>
              <Text style={modalStyles.secondaryButtonText}>Usuń</Text>
            </Pressable>
            <Pressable onPress={onSave} style={modalStyles.primaryButton}>
              <LinearGradient
                colors={BRAND_GRADIENT}
                end={BRAND_GRADIENT_END}
                start={BRAND_GRADIENT_START}
                style={modalStyles.primaryGradient}
              >
                <Text style={modalStyles.primaryText}>Zapisz</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function UniversityPortalModal({ autoLogin, cookies, loading, onClose, theme, title = 'Twoja Uczelnia', url, visible }) {
  const webViewRef = useRef(null);
  const modalStyles = useMemo(() => createUniversityPortalStyles(theme), [theme]);
  const isUsosPortal = autoLogin?.school === SCHOOL_USOS;
  const source = useMemo(() => {
    const cookieHeader = buildCookieHeader(cookies);
    return {
      uri: url,
      ...(cookieHeader ? { headers: { Cookie: cookieHeader } } : {})
    };
  }, [cookies, url]);
  const meritoAutofillScript = useMemo(() => {
    if (autoLogin?.school !== SCHOOL_MERITO || !autoLogin.email || !autoLogin.password) return '';
    return buildMeritoPortalAutofillScript(autoLogin.email, autoLogin.password);
  }, [autoLogin]);
  const pollubAutofillScript = useMemo(() => {
    if (autoLogin?.school !== SCHOOL_POLLUB || !autoLogin.email || !autoLogin.password) return '';
    return buildPollubPortalAutofillScript(autoLogin.email, autoLogin.password);
  }, [autoLogin]);
  const usosAutofillScript = useMemo(() => {
    if (!isUsosPortal || !autoLogin?.login || !autoLogin?.password) return '';
    return buildUsosPortalAutofillScript(autoLogin.login, autoLogin.password, url, autoLogin.portalUrl);
  }, [autoLogin, isUsosPortal, url]);
  const handlePortalNavigation = useCallback((navState) => {
    const navUrl = navState?.url || '';
    if (isUsosPortal && autoLogin?.login && autoLogin?.password) {
      if (
        shouldInjectUsosPortalAutofill(navUrl, autoLogin.portalUrl)
        || (autoLogin.portalUrl && isUsosPortalHostUrl(navUrl, autoLogin.portalUrl))
      ) {
        webViewRef.current?.injectJavaScript(
          buildUsosPortalAutofillScript(autoLogin.login, autoLogin.password, navUrl, autoLogin.portalUrl)
        );
      }
      return;
    }
    if (autoLogin?.school === SCHOOL_MERITO && autoLogin.email && autoLogin.password && isMeritoLoginUrl(navUrl)) {
      webViewRef.current?.injectJavaScript(
        buildMeritoPortalAutofillScript(autoLogin.email, autoLogin.password)
      );
      return;
    }
    if (autoLogin?.school === SCHOOL_POLLUB && autoLogin.email && autoLogin.password && isPollubPortalUrl(navUrl)) {
      webViewRef.current?.injectJavaScript(
        buildPollubPortalAutofillScript(autoLogin.email, autoLogin.password)
      );
    }
  }, [autoLogin, isUsosPortal]);
  const handlePortalLoadEnd = useCallback((event) => {
    if (!isUsosPortal || !autoLogin?.portalUrl) return;
    const navUrl = event?.nativeEvent?.url || url;
    if (isUsosPortalHostUrl(navUrl, autoLogin.portalUrl)) {
      webViewRef.current?.injectJavaScript(buildPortalHandshakeScript(autoLogin.portalUrl));
    }
  }, [autoLogin, isUsosPortal, url]);
  const autoLoginScript = useMemo(() => {
    if (isUsosPortal) return usosAutofillScript;
    if (autoLogin?.school === SCHOOL_MERITO) return meritoAutofillScript;
    if (autoLogin?.school === SCHOOL_POLLUB) return pollubAutofillScript;
    if (autoLogin?.school !== SCHOOL_CDV || !autoLogin.email || !autoLogin.password) return '';

    return `
      (function () {
        var email = ${JSON.stringify(autoLogin.email)};
        var password = ${JSON.stringify(autoLogin.password)};
        var target = ${JSON.stringify(autoLogin.target || 'wu')};
        var blackboardUrl = ${JSON.stringify(buildCdvBlackboardUrl(autoLogin.email))};
        var host = String(window.location.hostname || '').toLowerCase();

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

        function clickOrSubmit(input) {
          var submit = document.querySelector('#idSIButton9, input[type="submit"], button[type="submit"], button');
          if (submit && !submit.disabled) {
            submit.click();
            return true;
          }
          var form = input && input.form ? input.form : document.querySelector('form');
          if (form) {
            form.submit();
            return true;
          }
          return false;
        }

        function runWuLogin() {
          if (!/wu\\.cdv\\.pl$/i.test(host)) return true;
          var loginInput = document.querySelector('input[name="login"]');
          var passwordInput = document.querySelector('input[name="password"]');
          if (!loginInput || !passwordInput || window.__comamdzisCdvAutoLoginDone) return true;
          window.__comamdzisCdvAutoLoginDone = true;
          setValue(loginInput, email);
          setValue(passwordInput, password);
          var form = passwordInput.form || loginInput.form || document.querySelector('form');
          if (form) form.submit();
          return true;
        }

        function runBlackboardLogin() {
          if (host === 'cdv.blackboard.com') {
            var provider = document.querySelector('a[href*="/auth-saml/saml/login"], #loginRedirectProviderList a');
            if (provider && !window.__comamdzisBlackboardProviderClicked) {
              window.__comamdzisBlackboardProviderClicked = true;
              provider.click();
              return true;
            }
            return false;
          }

          if (!/login\\.microsoftonline\\.com$/i.test(host)) return false;

          var pageText = String(document.body && document.body.innerText || '');
          if (/AADSTS90100/i.test(pageText) && !window.__comamdzisMicrosoftLoginHintRetry) {
            window.__comamdzisMicrosoftLoginHintRetry = true;
            window.location.href = blackboardUrl;
            return true;
          }

          var emailInput = document.querySelector('input[type="email"], input[name="loginfmt"], #i0116');
          if (emailInput && emailInput.offsetParent !== null) {
            setValue(emailInput, email);
            if (String(emailInput.value || '').trim().toLowerCase() !== String(email || '').trim().toLowerCase()) return false;
            if (window.__comamdzisMicrosoftEmailDone) return true;
            window.__comamdzisMicrosoftEmailDone = true;
            clickOrSubmit(emailInput);
            return true;
          }

          var passwordInput = document.querySelector('input[type="password"], input[name="passwd"], #i0118');
          if (passwordInput && passwordInput.offsetParent !== null) {
            setValue(passwordInput, password);
            if (!String(passwordInput.value || '').length) return false;
            if (window.__comamdzisMicrosoftPasswordDone) return true;
            window.__comamdzisMicrosoftPasswordDone = true;
            clickOrSubmit(passwordInput);
            return true;
          }

          var keepSignedIn = document.querySelector('#KmsiDescription, input[name="DontShowAgain"]');
          if (keepSignedIn && !window.__comamdzisMicrosoftKmsiDone) {
            window.__comamdzisMicrosoftKmsiDone = true;
            var yesButton = document.querySelector('#idSIButton9');
            if (yesButton) yesButton.click();
            return true;
          }

          return false;
        }

        try {
          if (target === 'blackboard') {
            var attempts = 0;
            var timer = setInterval(function () {
              attempts += 1;
              try {
                runBlackboardLogin();
              } catch (error) {}
              if (attempts >= 40) clearInterval(timer);
            }, 500);
            runBlackboardLogin();
          } else {
            runWuLogin();
          }
        } catch (error) {}
        return true;
      })();
      true;
    `;
  }, [autoLogin, isUsosPortal, meritoAutofillScript, usosAutofillScript]);

  return (
    <Modal animationType="slide" onRequestClose={onClose} visible={visible}>
      <SafeAreaView style={modalStyles.safeArea}>
        <View style={modalStyles.toolbar}>
          <Pressable accessibilityLabel="Zamknij" hitSlop={8} onPress={onClose} style={modalStyles.closeButton}>
            <Ionicons color={theme.text} name="close" size={28} />
          </Pressable>
          <Text numberOfLines={1} style={modalStyles.toolbarTitle}>{title}</Text>
        </View>
        {loading ? (
          <View style={modalStyles.loadingWrap}>
            <ActivityIndicator color={theme.accent} size="large" />
          </View>
        ) : url ? (
          <WebView
            ref={webViewRef}
            domStorageEnabled={isUsosPortal || undefined}
            injectedJavaScriptBeforeContentLoaded={autoLoginScript}
            injectedJavaScript={autoLoginScript}
            onLoadEnd={handlePortalLoadEnd}
            onNavigationStateChange={handlePortalNavigation}
            originWhitelist={['*']}
            sharedCookiesEnabled
            source={source}
            startInLoadingState
            style={modalStyles.webView}
            thirdPartyCookiesEnabled
            userAgent={isUsosPortal ? usosWebViewUserAgent() : undefined}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const TEXT_MASK_DESCENDER_SLACK = 14;

function BrandGradientSurface({ children, compact = false, style, textMask = false }) {
  const [size, setSize] = useState(null);
  const layoutStyle = textMask
    ? [style, compact ? stylesTextMaskBleedCompact : stylesTextMaskBleed]
    : style;
  const descenderSlack = textMask && !compact ? TEXT_MASK_DESCENDER_SLACK : 0;
  const renderHeight = size ? size.height + descenderSlack : 0;

  if (!size) {
    return (
      <View
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setSize({ width: Math.ceil(width), height: Math.ceil(height) });
        }}
        style={[layoutStyle, stylesMeasureHidden]}
      >
        {children}
      </View>
    );
  }

  const maskedView = (
    <MaskedView
      maskElement={
        <View
          style={[
            layoutStyle,
            stylesMaskRoot,
            textMask && !compact && { height: renderHeight, justifyContent: 'flex-start' }
          ]}
        >
          {children}
        </View>
      }
      style={{ height: renderHeight, overflow: 'visible', width: size.width }}
    >
      <LinearGradient
        colors={BRAND_GRADIENT}
        end={BRAND_GRADIENT_END}
        start={BRAND_GRADIENT_START}
        style={{ height: renderHeight, width: size.width }}
      />
    </MaskedView>
  );

  if (!textMask || compact) return maskedView;

  return <View style={stylesTextMaskOuter}>{maskedView}</View>;
}

function createStudioBrandStyles(footerStyle = {}) {
  return {
    studioFooter: {
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 'auto',
      paddingTop: 28,
      ...footerStyle
    },
    studioBrandWrap: {
      opacity: 0.3
    },
    studioBrandRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6
    },
    studioVersion: {
      color: '#64748b',
      fontFamily: FONT.bodyBold,
      fontSize: 11,
      includeFontPadding: false,
      lineHeight: 16,
      marginRight: 4
    },
    studioLogoWrap: {
      height: 18,
      justifyContent: 'center',
      width: 38
    },
    studioLogo: {
      height: 18,
      width: 38
    },
    studioTextWrap: {
      height: 20,
      justifyContent: 'center',
      paddingRight: 2,
      width: 54
    },
    studioTextMask: {
      color: '#000000',
      fontFamily: FONT.title,
      fontSize: 13,
      includeFontPadding: false,
      lineHeight: 20
    }
  };
}

function StudioBrandFooter({ inline = false, styles }) {
  const brand = (
    <View style={styles.studioBrandWrap}>
      <View style={styles.studioBrandRow}>
        <Text style={styles.studioVersion}>v{APP_VERSION}</Text>
        <BrandGradientSurface style={styles.studioLogoWrap}>
          <Image resizeMode="contain" source={LOGO_221} style={styles.studioLogo} />
        </BrandGradientSurface>
        <BrandGradientSurface style={styles.studioTextWrap}>
          <Text style={styles.studioTextMask}>studios</Text>
        </BrandGradientSurface>
      </View>
    </View>
  );

  if (inline) return brand;

  return (
    <View style={styles.studioFooter}>
      {brand}
    </View>
  );
}

const stylesMeasureHidden = {
  opacity: 0
};

const stylesMaskRoot = {
  backgroundColor: 'transparent'
};

const stylesTextMaskBleed = {
  overflow: 'visible',
  paddingBottom: 12,
  paddingTop: 4
};

const stylesTextMaskBleedCompact = {
  overflow: 'visible',
  paddingBottom: 0,
  paddingTop: 0
};

const stylesTextMaskOuter = {
  alignSelf: 'center',
  overflow: 'visible'
};

function AnimatedHeaderTitle({ isTomorrow, styles }) {
  const progress = useRef(new Animated.Value(isTomorrow ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
      toValue: isTomorrow ? 1 : 0,
      useNativeDriver: true
    }).start();
  }, [isTomorrow, progress]);

  const todayOpacity = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0, 0]
  });
  const tomorrowOpacity = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0, 1]
  });
  const todayTranslateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -18]
  });
  const tomorrowTranslateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 0]
  });

  return (
    <View style={styles.headerTitleRow}>
      <Text style={styles.headerTitle}>comam</Text>
      <View style={styles.headerTitleSuffixSlot}>
        <Text importantForAccessibility="no-hide-descendants" style={styles.headerTitleMeasure}>
          jutro
        </Text>
        <View pointerEvents="none" style={styles.headerTitleSuffixClip}>
          <Animated.Text
            style={[
              styles.headerTitle,
              styles.headerTitleSuffixOverlay,
              { opacity: todayOpacity, transform: [{ translateY: todayTranslateY }] }
            ]}
          >
            dziś
          </Animated.Text>
          <Animated.Text
            style={[
              styles.headerTitle,
              styles.headerTitleSuffixOverlay,
              { opacity: tomorrowOpacity, transform: [{ translateY: tomorrowTranslateY }] }
            ]}
          >
            jutro
          </Animated.Text>
        </View>
      </View>
    </View>
  );
}

function SettingsShell({ children, drawer, drawerBackgroundColor, edgeSwipeEnabled = false, onClose, onOpen, open }) {
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  const draggingRef = useRef(false);
  const screenWidth = Dimensions.get('window').width;
  const drawerWidth = screenWidth * SETTINGS_DRAWER_RATIO;
  const peekWidth = screenWidth - drawerWidth;

  const animateProgress = useCallback((toValue) => {
    Animated.timing(progress, {
      duration: 280,
      easing: Easing.out(Easing.cubic),
      toValue,
      useNativeDriver: true
    }).start();
  }, [progress]);

  useEffect(() => {
    if (draggingRef.current) return;
    animateProgress(open ? 1 : 0);
  }, [animateProgress, open]);

  const finishOpenDrag = useCallback((gestureState) => {
    draggingRef.current = false;
    progress.stopAnimation((current) => {
      const shouldOpen = current >= SETTINGS_DRAG_OPEN_THRESHOLD || gestureState.vx < -0.35;
      if (shouldOpen) {
        onOpen?.();
        animateProgress(1);
        return;
      }
      animateProgress(0);
    });
  }, [animateProgress, onOpen, progress]);

  const finishCloseDrag = useCallback((gestureState) => {
    draggingRef.current = false;
    progress.stopAnimation((current) => {
      const shouldClose = current <= 1 - SETTINGS_DRAG_OPEN_THRESHOLD || gestureState.vx > 0.35;
      if (shouldClose) {
        onClose?.();
        animateProgress(0);
        return;
      }
      animateProgress(1);
    });
  }, [animateProgress, onClose, progress]);

  const edgePanResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => (
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy)
        && gestureState.dx < -6
      ),
      onPanResponderGrant: () => {
        draggingRef.current = true;
        progress.stopAnimation();
      },
      onPanResponderMove: (_, gestureState) => {
        const next = Math.min(1, Math.max(0, -gestureState.dx / drawerWidth));
        progress.setValue(next);
      },
      onPanResponderRelease: (_, gestureState) => finishOpenDrag(gestureState),
      onPanResponderTerminate: (_, gestureState) => finishOpenDrag(gestureState),
      onStartShouldSetPanResponder: () => false
    }),
    [drawerWidth, finishOpenDrag, progress]
  );

  const peekPanResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => (
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy)
        && gestureState.dx > 6
      ),
      onPanResponderGrant: () => {
        draggingRef.current = true;
        progress.stopAnimation();
      },
      onPanResponderMove: (_, gestureState) => {
        const next = Math.min(1, Math.max(0, 1 - gestureState.dx / drawerWidth));
        progress.setValue(next);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (Math.abs(gestureState.dx) < 10 && Math.abs(gestureState.dy) < 10) {
          draggingRef.current = false;
          onClose?.();
          animateProgress(0);
          return;
        }
        finishCloseDrag(gestureState);
      },
      onPanResponderTerminate: (_, gestureState) => finishCloseDrag(gestureState),
      onStartShouldSetPanResponder: () => true
    }),
    [animateProgress, drawerWidth, finishCloseDrag, onClose, progress]
  );

  const contentTranslateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -drawerWidth]
  });

  const contentOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SETTINGS_CONTENT_SCRIM_OPACITY]
  });
  const contentScrimOpacity = contentOpacity;

  const drawerTranslateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [drawerWidth, 0]
  });

  return (
    <View style={settingsShellStyles.root}>
      <Animated.View
        style={[
          settingsShellStyles.content,
          {
            width: screenWidth,
            transform: [{ translateX: contentTranslateX }]
          }
        ]}
      >
        {children}
        <Animated.View
          pointerEvents="none"
          style={[settingsShellStyles.contentScrim, { opacity: contentScrimOpacity }]}
        />
      </Animated.View>

      {open ? (
        <View
          accessibilityLabel="Zamknij ustawienia"
          accessibilityRole="button"
          {...peekPanResponder.panHandlers}
          style={[settingsShellStyles.peekOverlay, { width: peekWidth }]}
        />
      ) : null}

      {!open && edgeSwipeEnabled ? (
        <View
          {...edgePanResponder.panHandlers}
          style={[settingsShellStyles.edgeSwipeZone, { width: SETTINGS_EDGE_SWIPE_WIDTH }]}
        />
      ) : null}

      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[
          settingsShellStyles.drawer,
          {
            backgroundColor: drawerBackgroundColor,
            maxWidth: drawerWidth,
            transform: [{ translateX: drawerTranslateX }],
            width: drawerWidth
          }
        ]}
      >
        <View
          style={[
            settingsShellStyles.drawerSafeArea,
            { paddingBottom: insets.bottom, paddingTop: insets.top }
          ]}
        >
          {drawer}
        </View>
      </Animated.View>
    </View>
  );
}

function SettingsDrawerLogo({ darkMode, styles }) {
  const progress = useRef(new Animated.Value(darkMode ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      duration: 280,
      easing: Easing.out(Easing.cubic),
      toValue: darkMode ? 1 : 0,
      useNativeDriver: true
    }).start();
  }, [darkMode, progress]);

  const whiteOpacity = progress;
  const blackOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0]
  });

  return (
    <View style={styles.drawerBrandWrap}>
      <View style={styles.drawerLogoWrap}>
        <Animated.Image
          resizeMode="contain"
          source={APP_ICON_BLACK}
          style={[styles.drawerLogo, styles.drawerLogoLayer, { opacity: blackOpacity }]}
        />
        <Animated.Image
          resizeMode="contain"
          source={APP_ICON_WHITE}
          style={[styles.drawerLogo, styles.drawerLogoLayer, { opacity: whiteOpacity }]}
        />
      </View>
      <BrandGradientSurface style={styles.drawerBrandTextWrap} textMask>
        <Text style={styles.drawerBrandTextMask}>comamdziś</Text>
      </BrandGradientSurface>
    </View>
  );
}

function SettingsToggle({ onValueChange, styles, value }) {
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
      toValue: value ? 1 : 0,
      useNativeDriver: true
    }).start();
  }, [progress, value]);

  const thumbTranslateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SETTINGS_TOGGLE_TRAVEL]
  });
  const gradientOpacity = progress;
  const thumbGrayOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0]
  });
  const thumbWhiteOpacity = progress;

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      hitSlop={8}
      onPress={() => onValueChange(!value)}
    >
      <View style={styles.toggleTrack}>
        <Animated.View pointerEvents="none" style={[styles.toggleGradient, { opacity: gradientOpacity }]}>
          <LinearGradient
            colors={BRAND_GRADIENT}
            end={BRAND_GRADIENT_END}
            start={BRAND_GRADIENT_START}
            style={styles.toggleGradientFill}
          />
        </Animated.View>
        <Animated.View style={[styles.toggleThumb, { transform: [{ translateX: thumbTranslateX }] }]}>
          <Animated.View style={[styles.toggleThumbLayer, styles.toggleThumbGray, { opacity: thumbGrayOpacity }]} />
          <Animated.View style={[styles.toggleThumbLayer, styles.toggleThumbWhite, { opacity: thumbWhiteOpacity }]} />
        </Animated.View>
      </View>
    </Pressable>
  );
}

function SettingsMenuRow({ icon, iconColor, label, onPress, styles, trailing }) {
  const row = (
    <View style={styles.menuRow}>
      <Ionicons color={iconColor} name={icon} size={24} style={styles.menuIcon} />
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.menuLabel}>
        {label}
      </Text>
      {trailing ? <View style={styles.menuTrailing}>{trailing}</View> : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.menuRowPressable, pressed && styles.menuRowPressed]}>
        {row}
      </Pressable>
    );
  }

  return row;
}

function SettingsDrawer({
  cardVisibility,
  icalPlansSchoolLabel,
  onLogout,
  onManageIcalPlans,
  onManagePdfPlans,
  onOpenBlackboardPortal,
  onOpenUniversityPortal,
  onToggleCardVisibility,
  onToggleTheme,
  pdfPlansSchoolLabel,
  showIcalPlansManager,
  showBlackboardPortal,
  showPdfPlansManager,
  studentProfile,
  theme,
  themeName
}) {
  const darkMode = themeName === 'dark';
  const drawerStyles = useMemo(() => createSettingsDrawerStyles(theme), [theme]);

  return (
    <View style={drawerStyles.safeArea}>
      <ScrollView
        contentContainerStyle={drawerStyles.scrollContent}
        showsVerticalScrollIndicator={false}
        style={drawerStyles.scrollView}
      >
        <View style={drawerStyles.drawerMain}>
          <View style={drawerStyles.brandZone}>
            <SettingsDrawerLogo darkMode={darkMode} styles={drawerStyles} />
          </View>

          <View style={drawerStyles.menuBlock}>
        <StudentDataSection
          profile={studentProfile}
          styles={drawerStyles}
          theme={theme}
        />

        <Text style={drawerStyles.sectionTitle}>Ustawienia</Text>
        <SettingsMenuRow
          icon={darkMode ? 'sunny-outline' : 'moon-outline'}
          iconColor={theme.text}
          label="Motyw"
          styles={drawerStyles}
          trailing={(
            <SettingsToggle onValueChange={onToggleTheme} styles={drawerStyles} value={darkMode} />
          )}
        />

        <Text style={drawerStyles.sectionTitle}>Informacje dodatkowe</Text>
        {CARD_VISIBILITY_FIELDS.map((field) => (
          <SettingsMenuRow
            icon={field.icon}
            iconColor={theme.text}
            key={field.key}
            label={field.label}
            styles={drawerStyles}
            trailing={(
              <SettingsToggle
                onValueChange={() => onToggleCardVisibility(field.key)}
                styles={drawerStyles}
                value={cardVisibility[field.key]}
              />
            )}
          />
        ))}

        <Text style={drawerStyles.sectionTitle}>UCZELNIA</Text>
        <SettingsMenuRow
          icon="globe-outline"
          iconColor={theme.text}
          label="Twoja Uczelnia"
          onPress={onOpenUniversityPortal}
          styles={drawerStyles}
          trailing={<Ionicons color={theme.mutedText} name="open-outline" size={20} />}
        />
        {showBlackboardPortal ? (
          <SettingsMenuRow
            icon="school-outline"
            iconColor={theme.text}
            label="Blackboard"
            onPress={onOpenBlackboardPortal}
            styles={drawerStyles}
            trailing={<Ionicons color={theme.mutedText} name="open-outline" size={20} />}
          />
        ) : null}

        {showIcalPlansManager ? (
          <SettingsMenuRow
            icon="calendar-outline"
            iconColor={theme.text}
            label={`iCal planów (${icalPlansSchoolLabel})`}
            onPress={onManageIcalPlans}
            styles={drawerStyles}
            trailing={<Ionicons color={theme.mutedText} name="chevron-forward-outline" size={20} />}
          />
        ) : null}

        {showPdfPlansManager ? (
          <SettingsMenuRow
            icon="document-text-outline"
            iconColor={theme.text}
            label={`PDF planów (${pdfPlansSchoolLabel})`}
            onPress={onManagePdfPlans}
            styles={drawerStyles}
            trailing={<Ionicons color={theme.mutedText} name="chevron-forward-outline" size={20} />}
          />
        ) : null}

        <View style={drawerStyles.divider} />

        <View style={drawerStyles.footerRow}>
          <StudioBrandFooter inline styles={drawerStyles} />
          <Pressable
            accessibilityLabel="Wyloguj"
            onPress={onLogout}
            style={({ pressed }) => [drawerStyles.logoutFooterPressable, pressed && drawerStyles.menuRowPressed]}
          >
            <Ionicons color={theme.text} name="log-out-outline" size={24} />
            <Text style={drawerStyles.logoutFooterLabel}>Wyloguj</Text>
          </Pressable>
        </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function normalizeClassLabel(value) {
  return String(value || '').trim().toLowerCase();
}

function isDuplicateClassLabel(a, b) {
  const left = normalizeClassLabel(a);
  const right = normalizeClassLabel(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function capitalizeClassLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function buildClassMetaLabel(event) {
  const parts = [];
  const statusLabel = eventStatusLabel(event);
  if (statusLabel) parts.push(statusLabel);
  if (event.isImportantDate) parts.push('Ważny termin');
  if (event.form && !isDuplicateClassLabel(event.form, 'Ważny termin')) parts.push(event.form);
  return parts.map(capitalizeClassLabel).join(' | ');
}

const COLLEGIUM_DA_VINCI_PATTERN = /collegium\s+da\s+vinci/gi;

function shortenAddressPart(value) {
  return String(value || '').replace(COLLEGIUM_DA_VINCI_PATTERN, 'CDV').trim();
}

function formatClassAddress(buildingName, buildingAddress) {
  const parts = [buildingName, buildingAddress]
    .map(shortenAddressPart)
    .filter(Boolean);
  return parts.join(', ');
}

function ClassCard({ cardVisibility = DEFAULT_CARD_VISIBILITY, event, styles }) {
  const addressLabel = formatClassAddress(event.buildingName, event.buildingAddress);
  const roomLabel = formatPlanRoomLabel(event);
  const teacherLabel = event.teacherNames?.length
    ? event.teacherNames.join(', ')
    : String(event.teacherName || event.teachers || '').trim();
  const groupLabel = String(event.groupName || event.module || '').trim();
  const subjectLabel =
    event.subject && !isDuplicateClassLabel(event.subject, event.title) && !isDuplicateClassLabel(event.subject, event.module)
      ? event.subject
      : '';
  const additionalInfo = sanitizePlanAdditionalInfo(event);
  const metaLabel = buildClassMetaLabel(event);
  const isOnline = isPlanEventOnline(event);
  const showOnlineLink = isOnline && shouldShowPlanOnlineLink(event);
  const hasOnCampusLocation =
    Boolean(event.buildingName || event.buildingAddress || roomLabel) ||
    /^budynek$/i.test(String(event.locationMode || ''));
  const locationKindLabel = isOnline ? 'Online' : hasOnCampusLocation ? 'Stacjonarnie' : '';
  const hasLocationRow = Boolean(locationKindLabel || roomLabel || showOnlineLink);
  const showAddress = cardVisibility.address && addressLabel && !isOnline;
  const showGroup =
    cardVisibility.group &&
    groupLabel &&
    !isDuplicateClassLabel(groupLabel, event.title) &&
    !isDuplicateClassLabel(groupLabel, event.subject);
  const showSubject = Boolean(subjectLabel);
  const showTeacher = cardVisibility.teacher && teacherLabel;
  const showInfo = cardVisibility.info && additionalInfo;
  const showDetails = showAddress || showGroup || showSubject || showTeacher || showInfo;
  const crossedOut = isEventCrossedOut(event);
  const crossedOutStyle = crossedOut ? styles.classTextCrossedOut : null;
  const mutedCardStyle = crossedOut ? styles.classCardMuted : null;
  const mutedStripeStyle = crossedOut ? styles.classStripeMuted : null;

  return (
    <View style={[styles.classCard, mutedCardStyle]}>
      <View style={[styles.classStripe, { backgroundColor: event.color }, mutedStripeStyle]} />
      <View style={styles.classContent}>
        {hasLocationRow ? (
          <View style={styles.classTimeRow}>
            <View style={styles.classTimeSlot}>
              <Text numberOfLines={1} style={[styles.classTime, styles.classTimeSlotText, crossedOutStyle]}>
                {eventTimeRange(event)}
              </Text>
            </View>
            <View style={styles.classTimeSlot}>
              {locationKindLabel ? (
                <Text numberOfLines={1} style={[styles.classLocationKind, styles.classTimeSlotText, crossedOutStyle]}>
                  {locationKindLabel}
                </Text>
              ) : null}
            </View>
            <View style={styles.classTimeSlot}>
              {!isOnline && roomLabel ? (
                <Text numberOfLines={1} style={[styles.classLocationDetail, styles.classTimeSlotText, crossedOutStyle]}>
                  {roomLabel}
                </Text>
              ) : null}
              {showOnlineLink ? (
                <Pressable onPress={() => Linking.openURL(event.hangoutLink)}>
                  <Text numberOfLines={1} style={[styles.classLocationLink, styles.classTimeSlotText, crossedOutStyle]}>
                    {event.hangoutLinkLabel || 'Link do zajęć'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : (
          <Text style={[styles.classTime, styles.classTimeStandalone, crossedOutStyle]}>{eventTimeRange(event)}</Text>
        )}
        <Text style={[styles.classTitle, crossedOutStyle]}>{event.title}</Text>
        {metaLabel ? (
          <View style={styles.classMetaBadge}>
            <Text style={[styles.classMeta, crossedOutStyle]}>{metaLabel}</Text>
          </View>
        ) : null}
        {showDetails ? (
          <View style={styles.detailList}>
            {showAddress ? (
              <DetailRow label="Adres" numberOfLines={1} value={addressLabel} styles={styles} />
            ) : null}
            {showGroup ? <DetailRow label="Grupa" value={groupLabel} styles={styles} /> : null}
            {showSubject ? <DetailRow label="Przedmiot" value={subjectLabel} styles={styles} /> : null}
            {showTeacher ? <DetailRow label="Prowadzący" value={teacherLabel} styles={styles} /> : null}
            {showInfo ? <DetailRow label="Info" value={additionalInfo} styles={styles} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function DetailRow({ label, numberOfLines, value, accent = false, onPress, styles }) {
  const content = (
    <>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        ellipsizeMode={numberOfLines === 1 ? 'tail' : undefined}
        numberOfLines={numberOfLines}
        style={[styles.detailValue, accent && styles.detailValueAccent]}
      >
        {value}
      </Text>
    </>
  );

  if (onPress) {
    return (
      <Pressable style={styles.detailRow} onPress={onPress}>
        {content}
      </Pressable>
    );
  }

  return (
    <View style={styles.detailRow}>
      {content}
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.appBg
    },
    header: {
      backgroundColor: theme.headerBg,
      overflow: 'hidden',
      paddingHorizontal: 20,
      paddingBottom: 16,
      paddingTop: 42
    },
    headerTop: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'space-between',
      maxWidth: '100%',
      width: '100%'
    },
    headerBrand: {
      alignItems: 'center',
      flexDirection: 'row',
      flexShrink: 1,
      gap: 10
    },
    headerMonthToggle: {
      alignItems: 'center',
      flexShrink: 0,
      height: 30,
      justifyContent: 'center',
      width: 30
    },
    headerLogo: {
      height: 46,
      width: 46
    },
    headerTitle: {
      color: '#ffffff',
      fontFamily: FONT.title,
      fontSize: 24,
      includeFontPadding: false,
      lineHeight: 30,
      margin: 0,
      padding: 0
    },
    headerTitleRow: {
      alignItems: 'baseline',
      flexDirection: 'row',
      flexShrink: 1
    },
    headerTitleSuffixSlot: {
      position: 'relative'
    },
    headerTitleMeasure: {
      color: 'transparent',
      fontFamily: FONT.title,
      fontSize: 24,
      includeFontPadding: false,
      lineHeight: 30,
      margin: 0,
      padding: 0
    },
    headerTitleSuffixClip: {
      bottom: 0,
      left: 0,
      overflow: 'hidden',
      position: 'absolute',
      right: 0,
      top: 0
    },
    headerTitleSuffixOverlay: {
      left: 0,
      position: 'absolute',
      top: 0
    },
    settingsButton: {
      flexShrink: 0,
      alignItems: 'center',
      height: 30,
      justifyContent: 'center',
      padding: 0,
      width: 30
    },
    screen: {
      backgroundColor: theme.screenBg
    },
    scheduleScreen: {
      backgroundColor: theme.screenBg,
      flex: 1,
      overflow: 'hidden'
    },
    scheduleControls: {
      overflow: 'hidden',
      paddingHorizontal: 16,
      paddingTop: 16
    },
    scheduleList: {
      flex: 1
    },
    scheduleListContent: {
      paddingBottom: 32,
      paddingHorizontal: 16
    },
    content: {
      flexGrow: 1,
      padding: 16,
      paddingBottom: 32
    },
    loginPanel: {
      marginTop: 18,
      paddingVertical: 4
    },
    profileLoadingScreen: {
      alignItems: 'center',
      backgroundColor: theme.appBg,
      flex: 1,
      justifyContent: 'center',
      overflow: 'hidden',
      paddingHorizontal: 28
    },
    profileLoadingLogoWrap: {
      alignItems: 'center',
      height: 76,
      justifyContent: 'center',
      marginBottom: 12,
      width: 76
    },
    profileLoadingLogo: {
      height: 64,
      width: 64
    },
    profileLoadingLogin: {
      color: theme.text,
      fontFamily: FONT.bodyBold,
      fontSize: 14,
      marginBottom: 18,
      textAlign: 'center'
    },
    profileLoadingDots: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 7,
      height: 18,
      justifyContent: 'center'
    },
    profileLoadingDot: {
      borderRadius: 4,
      height: 8,
      overflow: 'hidden',
      width: 8
    },
    profileLoadingDotFill: {
      flex: 1
    },
    sectionTitle: {
      color: theme.text,
      fontFamily: FONT.title,
      fontSize: 20,
      marginBottom: 14,
      textAlign: 'center'
    },
    input: {
      backgroundColor: theme.screenBg,
      borderColor: theme.formMuted,
      borderRadius: 8,
      borderWidth: 1,
      color: theme.text,
      fontFamily: FONT.body,
      fontSize: 16,
      marginBottom: 12,
      minHeight: 48,
      paddingHorizontal: 14,
      paddingVertical: 12
    },
    inputFocused: {
      borderColor: theme.formFocus,
      borderWidth: 1.5
    },
    passwordRow: {
      position: 'relative'
    },
    passwordInput: {
      paddingRight: 48
    },
    passwordToggle: {
      alignItems: 'center',
      bottom: 14,
      height: 48,
      justifyContent: 'center',
      position: 'absolute',
      right: 2,
      width: 44
    },
    rememberRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
      marginBottom: 12
    },
    checkbox: {
      alignItems: 'center',
      borderColor: theme.formMuted,
      borderRadius: 5,
      borderWidth: 1,
      height: 22,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 22
    },
    checkboxActive: {
      backgroundColor: theme.formMuted,
      borderColor: theme.formMuted
    },
    checkboxPressed: {
      borderColor: theme.formFocus
    },
    rememberText: {
      color: theme.rememberText,
      fontFamily: FONT.body,
      fontSize: 14
    },
    detectedSchoolText: {
      color: theme.mutedText,
      fontFamily: FONT.bodyBold,
      fontSize: 13,
      marginBottom: 8
    },
    wszipFlow: {
      gap: 12
    },
    wszipSessionHint: {
      color: theme.mutedText,
      fontFamily: FONT.body,
      fontSize: 13,
      lineHeight: 18
    },
    wszipPdfSelected: {
      color: theme.text,
      fontFamily: FONT.bodyBold,
      fontSize: 13
    },
    wszipHelpLink: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6,
      marginTop: 2
    },
    wszipHelpLinkText: {
      color: theme.formFocus,
      fontFamily: FONT.body,
      fontSize: 13
    },
    pollubSessionHint: {
      color: theme.mutedText,
      fontFamily: FONT.body,
      fontSize: 13,
      lineHeight: 18,
      marginBottom: 10
    },
    pollubFlow: {
      gap: 12
    },
    watFlow: {
      gap: 12
    },
    watSectionLabel: {
      color: theme.text,
      fontFamily: FONT.bodyBold,
      fontSize: 14
    },
    watFacultyRow: {
      flexGrow: 0
    },
    watFacultyPill: {
      marginRight: 8,
      minWidth: 52
    },
    watFacultyPillText: {
      color: theme.mutedText,
      fontFamily: FONT.bodyBold,
      fontSize: 13
    },
    watFacultyPillTextActive: {
      color: theme.primaryButtonText
    },
    watGroupList: {
      borderColor: theme.border,
      borderRadius: 10,
      borderWidth: 1,
      maxHeight: 200
    },
    watGroupItem: {
      borderBottomColor: theme.divider,
      borderBottomWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 10
    },
    watGroupItemActive: {
      backgroundColor: theme.surfaceBgActive
    },
    watGroupItemText: {
      color: theme.text,
      fontFamily: FONT.body,
      fontSize: 14
    },
    watGroupItemTextActive: {
      color: theme.accent,
      fontFamily: FONT.bodyBold
    },
    watSelectedGroupText: {
      color: theme.accent,
      fontFamily: FONT.bodyBold,
      fontSize: 13
    },
    watGroupsLoading: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8
    },
    watGroupsError: {
      color: '#cf2e2e',
      fontFamily: FONT.body,
      fontSize: 13
    },
    pollubPdfSelected: {
      color: theme.mutedText,
      fontFamily: FONT.body,
      fontSize: 13
    },
    pollubPdfList: {
      gap: 8
    },
    usosIcalBox: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10
    },
    usosIcalAccordionTrigger: {
      alignItems: 'center',
      backgroundColor: 'transparent',
      flexDirection: 'row',
      gap: 10,
      justifyContent: 'space-between',
      minHeight: 48,
      paddingHorizontal: 14,
      paddingVertical: 12
    },
    loginOptionalButton: {
      alignItems: 'center',
      backgroundColor: 'transparent',
      borderColor: theme.formMuted,
      borderRadius: 8,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 48,
      paddingHorizontal: 14,
      paddingVertical: 12
    },
    loginOptionalButtonRow: {
      flexDirection: 'row',
      gap: 10,
      justifyContent: 'space-between'
    },
    loginOptionalButtonPressed: {
      backgroundColor: 'transparent',
      borderColor: theme.formFocus,
      borderWidth: 1.5
    },
    loginOptionalButtonOpen: {
      backgroundColor: theme.screenBg,
      borderColor: theme.formFocus,
      borderWidth: 1.5
    },
    loginOptionalButtonOpenPressed: {
      backgroundColor: theme.surfaceBgActive
    },
    loginOptionalButtonText: {
      color: theme.mutedText,
      fontFamily: FONT.bodyBold,
      fontSize: 14,
      textAlign: 'center'
    },
    loginOptionalButtonTextRow: {
      flex: 1,
      textAlign: 'left'
    },
    loginOptionalButtonTextOpen: {
      color: theme.text
    },
    usosIcalAccordionBody: {
      gap: 12
    },
    usosIcalInput: {
      flex: 1,
      marginBottom: 0
    },
    pollubPdfRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10
    },
    pollubPdfRemove: {
      padding: 2
    },
    pollubHelpLink: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6,
      marginTop: 2
    },
    pollubHelpLinkText: {
      color: theme.formFocus,
      fontFamily: FONT.body,
      fontSize: 13
    },
    secondaryButton: {
      alignItems: 'center',
      borderColor: theme.formFocus,
      borderRadius: 24,
      borderWidth: 1,
      height: 44,
      justifyContent: 'center',
      marginTop: 4
    },
    secondaryButtonText: {
      color: theme.text,
      fontFamily: FONT.bodyBold,
      fontSize: 14
    },
    primaryButton: {
      borderRadius: 24,
      height: 48,
      minHeight: 48,
      overflow: 'hidden'
    },
    primaryButtonRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      marginTop: 12
    },
    primaryButtonFlex: {
      flex: 1,
      marginTop: 0
    },
    loginCancelButton: {
      alignItems: 'center',
      backgroundColor: theme.screenBg,
      borderColor: theme.formMuted,
      borderRadius: 24,
      borderWidth: 1,
      height: 48,
      justifyContent: 'center',
      width: 48
    },
    loginCancelButtonPressed: {
      opacity: 0.75
    },
    primaryButtonDisabled: {
      opacity: 0.75
    },
    primaryButtonGradient: {
      alignItems: 'center',
      flex: 1,
      height: 48,
      justifyContent: 'center',
      minHeight: 48
    },
    primaryButtonText: {
      color: theme.text,
      fontFamily: FONT.bodyBold,
      fontSize: 16
    },
    primaryButtonLoading: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
      justifyContent: 'center',
      paddingHorizontal: 14
    },
    primaryButtonLoadingText: {
      color: theme.text,
      flexShrink: 1,
      fontFamily: FONT.bodyBold,
      fontSize: 13,
      textAlign: 'center'
    },
    loginPhaseText: {
      color: theme.mutedText,
      fontFamily: FONT.body,
      fontSize: 12,
      marginTop: 8
    },
    savedProfiles: {
      borderTopColor: theme.divider,
      borderTopWidth: 1,
      gap: 8,
      marginTop: 16,
      paddingTop: 14
    },
    savedProfilesTitle: {
      color: theme.mutedText,
      fontFamily: FONT.bodyBold,
      fontSize: 12,
      textTransform: 'uppercase'
    },
    profileButton: {
      alignItems: 'center',
      backgroundColor: theme.screenBg,
      borderColor: theme.formMuted,
      borderRadius: 999,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 4,
      minHeight: 48,
      paddingLeft: 14,
      paddingRight: 2,
      paddingVertical: 12
    },
    profileButtonMain: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: 12,
      minWidth: 0
    },
    profileButtonPressed: {
      opacity: 0.72
    },
    profileRemoveButton: {
      alignItems: 'center',
      borderRadius: 999,
      flexShrink: 0,
      height: 32,
      justifyContent: 'center',
      width: 44
    },
    profileLogoBox: {
      alignItems: 'center',
      borderRadius: 7,
      flexShrink: 0,
      height: 44,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 112
    },
    profileLogoBoxDark: {
      backgroundColor: '#050505',
      paddingHorizontal: 8
    },
    profileSchoolLogo: {
      height: 34,
      maxHeight: 34,
      maxWidth: 104,
      tintColor: PROFILE_LOGO_TINT,
      width: 104
    },
    profileTextBlock: {
      flex: 1
    },
    profileLogin: {
      color: theme.text,
      fontFamily: FONT.bodyBold,
      fontSize: 14
    },
    profileSchool: {
      color: theme.mutedText,
      fontFamily: FONT.body,
      fontSize: 12,
      marginTop: 2
    },
    ...createStudioBrandStyles(),
    toolbar: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      marginBottom: 14
    },
    toolbarRange: {
      flex: 1,
      minWidth: 0,
      overflow: 'hidden'
    },
    rangeTitleRow: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 24,
      width: '100%'
    },
    rangeTitleGradient: {
      alignSelf: 'center',
      height: 24,
      maxWidth: '100%',
      width: '100%'
    },
    rangeTitleGradientFill: {
      height: 24,
      width: '100%'
    },
    rangeTitleMaskWrap: {
      backgroundColor: 'transparent',
      height: 24,
      justifyContent: 'center',
      width: '100%'
    },
    rangeTitleMask: {
      color: '#000000',
      fontFamily: FONT.title,
      fontSize: 20,
      includeFontPadding: false,
      lineHeight: 24,
      textAlign: 'center',
      width: '100%'
    },
    quickDayRow: {
      alignItems: 'center',
      flexDirection: 'row',
      marginTop: 10
    },
    quickDayCenter: {
      flexDirection: 'row',
      flexShrink: 0,
      gap: 8
    },
    navArrowSlot: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      minHeight: 48,
      paddingVertical: 4
    },
    monthSlider: {
      alignSelf: 'stretch',
      marginBottom: 6,
      marginHorizontal: -16,
      marginTop: 0,
      maxWidth: '100%'
    },
    monthSliderContent: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: 16,
      paddingVertical: 6
    },
    monthSliderYear: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: MONTH_SLIDER_YEAR_WIDTH,
      paddingHorizontal: 4
    },
    monthSliderYearText: {
      color: theme.mutedText,
      fontFamily: FONT.bodyBold,
      fontSize: 12
    },
    monthSliderItem: {
      alignItems: 'center',
      backgroundColor: theme.surfaceBg,
      borderRadius: 999,
      height: 34,
      justifyContent: 'center',
      minWidth: MONTH_SLIDER_ITEM_WIDTH,
      paddingHorizontal: 10
    },
    monthSliderItemText: {
      color: theme.fieldText,
      fontFamily: FONT.bodyBold,
      fontSize: 13,
      textAlign: 'center'
    },
    monthSliderItemTextActive: {
      color: BRAND_GRADIENT_TEXT,
      fontFamily: FONT.bodyBold,
      fontSize: 13,
      textAlign: 'center'
    },
    quickDayButton: {
      alignItems: 'center',
      backgroundColor: theme.surfaceBg,
      borderRadius: 999,
      justifyContent: 'center',
      minHeight: 40,
      paddingVertical: 8,
      width: 96
    },
    quickDayButtonText: {
      color: theme.fieldText,
      fontFamily: FONT.bodyBold,
      fontSize: 14,
      textAlign: 'center'
    },
    quickDayButtonTextActive: {
      color: BRAND_GRADIENT_TEXT,
      fontFamily: FONT.bodyBold,
      fontSize: 14,
      textAlign: 'center'
    },
    syncText: {
      color: theme.mutedText,
      fontFamily: FONT.body,
      fontSize: 12,
      marginBottom: 10
    },
    loadingPanel: {
      alignItems: 'center',
      backgroundColor: theme.surfaceBg,
      borderRadius: 8,
      flexDirection: 'row',
      gap: 10,
      marginBottom: 10,
      padding: 14
    },
    loadingText: {
      color: theme.secondaryText,
      fontFamily: FONT.bodyBold
    },
    emptyState: {
      alignItems: 'center',
      backgroundColor: theme.surfaceBg,
      borderRadius: 8,
      padding: 22
    },
    emptyTitle: {
      color: theme.fieldText,
      fontFamily: FONT.title,
      fontSize: 16
    },
    emptyHint: {
      color: theme.mutedText,
      fontFamily: FONT.body,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 8,
      textAlign: 'center'
    },
    emptyAction: {
      marginTop: 14
    },
    emptyActionText: {
      color: theme.text,
      fontFamily: FONT.bodyBold,
      fontSize: 14
    },
    daySection: {
      marginTop: 14
    },
    dayTitle: {
      color: theme.text,
      fontFamily: FONT.title,
      fontSize: 17,
      marginBottom: 8
    },
    noClasses: {
      color: theme.fieldText,
      fontFamily: FONT.body,
      fontSize: 14,
      paddingVertical: 8
    },
    classCard: {
      backgroundColor: theme.surfaceBg,
      borderRadius: 8,
      flexDirection: 'row',
      marginBottom: 10,
      overflow: 'hidden',
      shadowColor: theme.shadow,
      shadowOpacity: theme.name === 'dark' ? 0.18 : 0.06,
      shadowRadius: 8,
      elevation: 1
    },
    classCardMuted: {
      opacity: 0.58
    },
    classStripe: {
      width: 7
    },
    classStripeMuted: {
      opacity: 0.72
    },
    classTextCrossedOut: {
      textDecorationLine: 'line-through',
      textDecorationStyle: 'solid',
      color: theme.mutedText
    },
    classContent: {
      flex: 1,
      padding: 12
    },
    classTimeRow: {
      flexDirection: 'row',
      marginBottom: 4
    },
    classTimeSlot: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      minWidth: 0,
      paddingHorizontal: 2
    },
    classTimeSlotText: {
      textAlign: 'center',
      width: '100%'
    },
    classTime: {
      color: theme.accent,
      fontFamily: FONT.bodyBold,
      fontSize: 13
    },
    classTimeStandalone: {
      marginBottom: 4
    },
    classLocationKind: {
      color: theme.mutedText,
      fontFamily: FONT.bodyBold,
      fontSize: 13
    },
    classLocationDetail: {
      color: theme.secondaryText,
      fontFamily: FONT.body,
      fontSize: 13
    },
    classLocationLink: {
      color: theme.accentDark,
      fontFamily: FONT.bodyBold,
      fontSize: 13
    },
    classTitle: {
      color: theme.text,
      fontFamily: FONT.title,
      fontSize: 16,
      lineHeight: 21
    },
    classMetaBadge: {
      alignSelf: 'flex-start',
      backgroundColor: theme.surfaceBg,
      borderColor: theme.metaBadgeBorder,
      borderRadius: 6,
      borderWidth: 1,
      marginTop: 10,
      paddingHorizontal: 10,
      paddingVertical: 4
    },
    classMeta: {
      color: theme.text,
      fontFamily: FONT.bodyBold,
      fontSize: 14,
      lineHeight: 18
    },
    detailList: {
      borderTopColor: theme.divider,
      borderTopWidth: 1,
      gap: 4,
      marginTop: 10,
      paddingTop: 8
    },
    detailRow: {
      alignItems: 'baseline',
      flexDirection: 'row',
      gap: 8
    },
    detailLabel: {
      color: theme.mutedText,
      fontFamily: FONT.bodyBold,
      fontSize: 12,
      includeFontPadding: false,
      lineHeight: 17,
      minWidth: 78
    },
    detailValue: {
      color: theme.secondaryText,
      flex: 1,
      flexShrink: 1,
      fontFamily: FONT.body,
      fontSize: 12,
      includeFontPadding: false,
      lineHeight: 17,
      minWidth: 0
    },
    detailValueAccent: {
      color: theme.accentDark,
      fontFamily: FONT.bodyBold
    }
  });
}

const settingsShellStyles = StyleSheet.create({
  content: {
    flex: 1,
    overflow: 'hidden'
  },
  contentScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    zIndex: 20
  },
  drawer: {
    bottom: 0,
    elevation: 12,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    shadowColor: '#000000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    top: 0,
    zIndex: 3
  },
  drawerSafeArea: {
    flex: 1
  },
  edgeSwipeZone: {
    bottom: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 4
  },
  peekOverlay: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    zIndex: 2
  },
  root: {
    flex: 1,
    overflow: 'hidden'
  }
});

function createUniversityPortalStyles(theme) {
  return StyleSheet.create({
    closeButton: {
      alignItems: 'center',
      height: 40,
      justifyContent: 'center',
      width: 40
    },
    loadingWrap: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center'
    },
    safeArea: {
      backgroundColor: theme.screenBg,
      flex: 1
    },
    toolbar: {
      alignItems: 'center',
      borderBottomColor: theme.divider,
      borderBottomWidth: 1,
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    toolbarTitle: {
      color: theme.text,
      flex: 1,
      fontFamily: FONT.bodyBold,
      fontSize: 16
    },
    webView: {
      flex: 1
    }
  });
}

function createUsosIcalManagerStyles(theme) {
  return StyleSheet.create({
    closeButton: {
      alignItems: 'center',
      backgroundColor: theme.surfaceBg,
      borderRadius: 20,
      height: 40,
      justifyContent: 'center',
      width: 40
    },
    confirmText: {
      color: theme.text,
      fontFamily: FONT.body,
      fontSize: 15,
      lineHeight: 22
    },
    footer: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 14
    },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      marginBottom: 16
    },
    helpLink: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6,
      marginTop: 10
    },
    helpText: {
      color: theme.formFocus,
      fontFamily: FONT.bodyBold,
      fontSize: 13
    },
    iconWrap: {
      alignItems: 'center',
      borderRadius: 16,
      height: 48,
      justifyContent: 'center',
      width: 48
    },
    input: {
      backgroundColor: theme.screenBg,
      borderColor: theme.formMuted,
      borderRadius: 8,
      borderWidth: 1,
      color: theme.text,
      fontFamily: FONT.body,
      fontSize: 15,
      minHeight: 48,
      paddingHorizontal: 14,
      paddingVertical: 12
    },
    panel: {
      backgroundColor: theme.screenBg,
      borderRadius: 20,
      maxWidth: 520,
      padding: 18,
      width: '100%'
    },
    primaryButton: {
      borderRadius: 12,
      flex: 1,
      overflow: 'hidden'
    },
    primaryGradient: {
      alignItems: 'center',
      paddingVertical: 12
    },
    primaryText: {
      color: BRAND_GRADIENT_TEXT,
      fontFamily: FONT.bodyBold,
      fontSize: 14
    },
    scrim: {
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.45)',
      flex: 1,
      justifyContent: 'center',
      padding: 20
    },
    secondaryButton: {
      alignItems: 'center',
      backgroundColor: theme.activeBg,
      borderColor: theme.border,
      borderRadius: 12,
      borderWidth: 1,
      flex: 1,
      justifyContent: 'center',
      paddingVertical: 12
    },
    secondaryButtonText: {
      color: theme.fieldText,
      fontFamily: FONT.bodyBold,
      fontSize: 14
    },
    subtitle: {
      color: theme.mutedText,
      fontFamily: FONT.body,
      fontSize: 13,
      marginTop: 2
    },
    title: {
      color: theme.text,
      fontFamily: FONT.bodyBold,
      fontSize: 17
    },
    titleBlock: {
      flex: 1
    }
  });
}

function createUsosIcalHelpStyles(theme) {
  return StyleSheet.create({
    actionButton: {
      borderRadius: 24,
      height: 48,
      marginTop: 18,
      overflow: 'hidden'
    },
    actionGradient: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center'
    },
    actionText: {
      color: BRAND_GRADIENT_TEXT,
      fontFamily: FONT.bodyBold,
      fontSize: 16
    },
    closeButton: {
      alignItems: 'center',
      backgroundColor: theme.surfaceBg,
      borderRadius: 20,
      height: 40,
      justifyContent: 'center',
      width: 40
    },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      marginBottom: 18
    },
    iconWrap: {
      alignItems: 'center',
      borderRadius: 22,
      height: 44,
      justifyContent: 'center',
      width: 44
    },
    panel: {
      backgroundColor: theme.panelBg,
      borderColor: theme.border,
      borderRadius: 8,
      borderWidth: 1,
      elevation: 16,
      maxWidth: 440,
      padding: 18,
      shadowColor: theme.shadow,
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.22,
      shadowRadius: 24,
      width: '100%'
    },
    scrim: {
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.58)',
      flex: 1,
      justifyContent: 'center',
      padding: 18
    },
    stepNumber: {
      alignItems: 'center',
      borderRadius: 14,
      height: 28,
      justifyContent: 'center',
      marginTop: 1,
      width: 28
    },
    stepNumberText: {
      color: BRAND_GRADIENT_TEXT,
      fontFamily: FONT.bodyBold,
      fontSize: 13
    },
    stepRow: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: 12
    },
    stepText: {
      color: theme.text,
      flex: 1,
      fontFamily: FONT.body,
      fontSize: 14,
      lineHeight: 20
    },
    steps: {
      gap: 14
    },
    subtitle: {
      color: theme.mutedText,
      fontFamily: FONT.body,
      fontSize: 13,
      marginTop: 2
    },
    title: {
      color: theme.text,
      fontFamily: FONT.title,
      fontSize: 20
    },
    titleBlock: {
      flex: 1,
      minWidth: 0
    }
  });
}

function createSettingsDrawerStyles(theme) {
  return StyleSheet.create({
    ...createStudioBrandStyles({
      alignItems: 'flex-start',
      marginTop: 0,
      paddingTop: 0
    }),
    divider: {
      backgroundColor: theme.divider,
      height: 1,
      marginVertical: 8
    },
    footerRow: {
      alignItems: 'center',
      alignSelf: 'stretch',
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: 52,
      paddingHorizontal: 20,
      paddingVertical: 10,
      width: '100%'
    },
    logoutFooterLabel: {
      color: theme.text,
      fontFamily: FONT.bodyBold,
      fontSize: 16
    },
    logoutFooterPressable: {
      alignItems: 'center',
      flexDirection: 'row',
      flexShrink: 0,
      gap: 8,
      marginLeft: 12
    },
    studioBrandWrap: {
      flexShrink: 1,
      minWidth: 0,
      opacity: 0.3
    },
    brandZone: {
      alignItems: 'center',
      flexGrow: 0,
      justifyContent: 'center',
      overflow: 'hidden',
      paddingTop: 40,
      width: '100%',
      zIndex: 2
    },
    drawerMain: {
      alignSelf: 'stretch',
      flexGrow: 0,
      width: '100%'
    },
    drawerBrandTextMask: {
      color: '#000000',
      fontFamily: FONT.title,
      fontSize: 28,
      includeFontPadding: false,
      lineHeight: 44,
      paddingBottom: 2
    },
    drawerBrandTextWrap: {
      alignSelf: 'center',
      justifyContent: 'flex-start',
      marginTop: 8,
      maxWidth: '100%',
      overflow: 'hidden',
      paddingHorizontal: 4
    },
    drawerBrandWrap: {
      alignItems: 'center',
      maxWidth: '100%',
      overflow: 'hidden',
      paddingBottom: 4
    },
    drawerLogo: {
      height: SETTINGS_DRAWER_LOGO_SIZE,
      width: SETTINGS_DRAWER_LOGO_SIZE
    },
    drawerLogoLayer: {
      left: 0,
      position: 'absolute',
      top: 0
    },
    drawerLogoWrap: {
      alignItems: 'center',
      height: SETTINGS_DRAWER_LOGO_SIZE,
      justifyContent: 'center',
      width: SETTINGS_DRAWER_LOGO_SIZE
    },
    menuBlock: {
      flexGrow: 0,
      justifyContent: 'flex-start',
      marginTop: 4,
      width: '100%',
      zIndex: 1
    },
    menuIcon: {
      marginRight: 16
    },
    menuLabel: {
      color: theme.text,
      flex: 1,
      flexShrink: 1,
      fontFamily: FONT.bodyBold,
      fontSize: 16,
      minWidth: 0
    },
    menuRow: {
      alignItems: 'center',
      alignSelf: 'stretch',
      flexDirection: 'row',
      minHeight: 52,
      paddingHorizontal: 20,
      paddingVertical: 10,
      width: '100%'
    },
    menuRowPressable: {
      alignSelf: 'stretch',
      width: '100%'
    },
    menuRowPressed: {
      backgroundColor: theme.panelAlt
    },
    menuTrailing: {
      flexShrink: 0,
      marginLeft: 12
    },
    safeArea: {
      alignSelf: 'stretch',
      backgroundColor: theme.screenBg,
      flex: 1,
      width: '100%'
    },
    scrollView: {
      alignSelf: 'stretch',
      flex: 1,
      width: '100%'
    },
    scrollContent: {
      flexGrow: 1,
      paddingBottom: 12,
      width: '100%'
    },
    sectionTitle: {
      color: theme.mutedText,
      fontFamily: FONT.bodyBold,
      fontSize: 12,
      letterSpacing: 0.6,
      marginBottom: 4,
      marginTop: 12,
      paddingHorizontal: 20,
      textTransform: 'uppercase'
    },
    sectionTitleFirst: {
      marginTop: 0
    },
    studentDataBlock: {
      marginBottom: 4,
      width: '100%'
    },
    studentDataRow: {
      paddingHorizontal: 20,
      paddingVertical: 6
    },
    studentDataLabel: {
      color: theme.mutedText,
      fontFamily: FONT.body,
      fontSize: 12,
      marginBottom: 4
    },
    studentDataInput: {
      backgroundColor: theme.surfaceBg,
      borderColor: theme.divider,
      borderRadius: 10,
      borderWidth: 1,
      color: theme.text,
      fontFamily: FONT.body,
      fontSize: 14,
      minHeight: 40,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    studentDataValue: {
      color: theme.text,
      fontFamily: FONT.body,
      fontSize: 14,
      lineHeight: 20,
      paddingVertical: 2
    },
    toggleGradient: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: 999
    },
    toggleGradientFill: {
      flex: 1
    },
    toggleThumb: {
      height: SETTINGS_TOGGLE_THUMB,
      width: SETTINGS_TOGGLE_THUMB
    },
    toggleThumbGray: {
      backgroundColor: '#d1d5db'
    },
    toggleThumbLayer: {
      borderRadius: 999,
      bottom: 0,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0
    },
    toggleThumbWhite: {
      backgroundColor: '#ffffff',
      elevation: 1,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.12,
      shadowRadius: 2
    },
    toggleTrack: {
      backgroundColor: theme.surfaceBg,
      borderColor: theme.divider,
      borderRadius: 999,
      borderWidth: 1,
      height: SETTINGS_TOGGLE_HEIGHT,
      justifyContent: 'center',
      overflow: 'hidden',
      padding: SETTINGS_TOGGLE_PADDING,
      width: SETTINGS_TOGGLE_WIDTH
    }
  });
}
