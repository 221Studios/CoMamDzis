import { splitCookiesString } from 'set-cookie-parser';
import { NativeModules } from 'react-native';

import { isReactNative, readResponseHeader } from './httpCookies.js';

const REQUEST_TIMEOUT_MS = 35000;

let blobModule;

function hasBlobUtilNativeModule() {
  if (!isReactNative()) return false;
  return Boolean(NativeModules.ReactNativeBlobUtil);
}

function getBlobUtil() {
  if (!isReactNative()) return null;
  if (blobModule !== undefined) return blobModule;
  if (!hasBlobUtilNativeModule()) {
    blobModule = null;
    return null;
  }
  try {
    // eslint-disable-next-line global-require
    const loaded = require('react-native-blob-util').default;
    blobModule = loaded?.config ? loaded : null;
  } catch {
    blobModule = null;
  }
  return blobModule;
}

export function usesUsosBlobTransport() {
  return Boolean(getBlobUtil());
}

function normalizeResponseHeaders(raw) {
  const lowered = {};
  Object.entries(raw || {}).forEach(([key, value]) => {
    lowered[String(key).toLowerCase()] = value;
  });

  return {
    get(name) {
      const value = lowered[String(name).toLowerCase()];
      if (value == null) return '';
      if (Array.isArray(value)) return value.join(', ');
      return String(value);
    },
    getSetCookie() {
      const value = lowered['set-cookie'];
      if (!value) return [];
      if (Array.isArray(value)) return value.map((entry) => String(entry));
      return splitCookiesString(String(value));
    }
  };
}

export function createUsosHttpResponse(status, rawHeaders, bodyText) {
  const headers = normalizeResponseHeaders(rawHeaders);
  const body = String(bodyText ?? '');

  return {
    status,
    headers,
    async text() {
      return body;
    }
  };
}

function withTimeout(promise, url) {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`USOS HTTP timeout: ${url}`));
    }, REQUEST_TIMEOUT_MS);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

async function requestViaBlobUtil(blob, url, { method, headers, body }) {
  const task = blob
    .config({ followRedirect: false })
    .fetch(method, url, headers, body ?? undefined);

  const response = await withTimeout(task, url);
  const info = response.info();
  const status = info?.status ?? 0;
  const rawHeaders = info?.headers ?? {};
  const text = await response.text();

  return createUsosHttpResponse(status, rawHeaders, text);
}

async function requestViaFetch(url, { method, headers, body }) {
  const response = await withTimeout(
    fetch(url, {
      method,
      headers,
      body,
      redirect: 'manual'
    }),
    url
  );

  const text = await response.text();
  const rawHeaders = {};

  if (typeof response.headers?.forEach === 'function') {
    response.headers.forEach((value, key) => {
      rawHeaders[key] = value;
    });
  } else if (response.headers?.map) {
    Object.assign(rawHeaders, response.headers.map);
  }

  if (typeof response.headers?.getSetCookie === 'function') {
    const setCookies = response.headers.getSetCookie();
    if (setCookies?.length) rawHeaders['set-cookie'] = setCookies;
  }

  return createUsosHttpResponse(response.status, rawHeaders, text);
}

/**
 * One HTTP hop with redirects disabled — for CAS/USOS 302 chains.
 * Uses react-native-blob-util on device, fetch+manual on Node tests.
 */
export async function usosHttpRequest(url, { method = 'GET', headers = {}, body } = {}) {
  const blob = getBlobUtil();
  if (blob) {
    return requestViaBlobUtil(blob, url, { method, headers, body });
  }
  return requestViaFetch(url, { method, headers, body });
}

export function readRedirectLocation(headers, baseUrl) {
  const location =
    readResponseHeader(headers, 'location') || readResponseHeader(headers, 'Location');
  if (!location) return '';
  try {
    return new URL(location, baseUrl).toString();
  } catch {
    return location;
  }
}
