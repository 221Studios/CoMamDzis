export function serializeCookieJar(jar) {
  if (!jar?.size) return [];
  return Array.from(jar.entries()).map(([name, value]) => ({
    name: String(name),
    value: String(value)
  }));
}

export function buildCookieHeader(cookies) {
  return (cookies || [])
    .filter((entry) => entry?.name)
    .map((entry) => `${entry.name}=${entry.value}`)
    .join('; ');
}
