import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const writeJson = (file, value) => {
  fs.writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);
};

const parseVersion = (version) => {
  const parts = String(version || '0.0.0').split('.').map((part) => Number.parseInt(part, 10));
  while (parts.length < 3) parts.push(0);
  return parts.map((part) => (Number.isFinite(part) ? part : 0));
};

const appJson = readJson('app.json');
const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');

const [major, minor, patch] = parseVersion(appJson.expo?.version || packageJson.version);
const nextVersion = `${major}.${minor}.${patch + 1}`;
const currentVersionCode = Number.parseInt(appJson.expo?.android?.versionCode || '1', 10);
const nextVersionCode = Number.isFinite(currentVersionCode) ? currentVersionCode + 1 : 2;

appJson.expo.version = nextVersion;
appJson.expo.android = {
  ...(appJson.expo.android || {}),
  versionCode: nextVersionCode
};

packageJson.version = nextVersion;

if (packageLock.version) packageLock.version = nextVersion;
if (packageLock.packages?.['']) packageLock.packages[''].version = nextVersion;

writeJson('app.json', appJson);
writeJson('package.json', packageJson);
writeJson('package-lock.json', packageLock);

const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  gradle = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${nextVersionCode}`)
    .replace(/versionName\s+"[^"]+"/, `versionName "${nextVersion}"`);
  fs.writeFileSync(gradlePath, gradle);
}

console.log(`Version bumped to ${nextVersion} (${nextVersionCode})`);
