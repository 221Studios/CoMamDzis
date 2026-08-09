import * as WebBrowser from 'expo-web-browser';

export const MOODLE_BASE_URL = 'https://mdl.wszip.poznan.pl';
export const MOODLE_LOGIN_URL = `${MOODLE_BASE_URL}/login/index.php`;
export const MOODLE_HOME_URL = `${MOODLE_BASE_URL}/my/`;

export async function openMoodleInBrowser() {
  WebBrowser.maybeCompleteAuthSession();
  return WebBrowser.openBrowserAsync(MOODLE_LOGIN_URL, {
    showInRecents: true,
    enableBarCollapsing: false
  });
}

export async function openMoodleHomeInBrowser() {
  return WebBrowser.openBrowserAsync(MOODLE_HOME_URL, {
    showInRecents: true,
    enableBarCollapsing: false
  });
}
