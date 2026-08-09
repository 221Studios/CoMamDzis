import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  extractRoomAndBuildingLines,
  formatPlanRoomLabel,
  formatUsosBuildingLabel,
  parseUsosIcalEventLocation,
  sanitizePlanAdditionalInfo,
  shouldShowPlanOnlineLink,
  stripUrlsFromPlanText
} = await import(pathToFileURL(join(root, 'src/planEventInfo.js')).href);

assert.equal(
  stripUrlsFromPlanText('Zajęcia w sali 101 https://usosweb.usos.pw.edu.pl/kontroler.php?_action=tt'),
  'Zajęcia w sali 101'
);

assert.equal(
  extractRoomAndBuildingLines(
    'Prowadzący: dr Kowalski\nSala: 101\nGmach ITLiMS (Gmach Nowy Lotniczy)\nhttps://usosweb.usos.pw.edu.pl/foo'
  ),
  'Sala: 101\nGmach ITLiMS (Gmach Nowy Lotniczy)'
);

assert.equal(formatUsosBuildingLabel('Gmach ITLiMS (Gmach Nowy Lotniczy)', 'ITLiMS-A2'), 'bud.1130-ITLiMS');
assert.equal(formatUsosBuildingLabel('Gmach ITC', 'ITC-TB1'), 'bud.1130-ITC');
assert.equal(formatUsosBuildingLabel('Gmach Główny', '144'), 'Gmach Główny');

const parsed = parseUsosIcalEventLocation(
  'Sala: ITLiMS-A2\nGmach ITLiMS (Gmach Nowy Lotniczy)\n\nhttps://usosweb.usos.pw.edu.pl/foo',
  'Nowowiejska 24, 00-665 Warszawa'
);
assert.equal(parsed.roomName, 'ITLiMS-A2');
assert.equal(parsed.buildingName, 'bud.1130-ITLiMS');
assert.equal(parsed.buildingAddress, 'Nowowiejska 24, 00-665 Warszawa');
assert.equal(parsed.additionalInfo, 'Sala: ITLiMS-A2\nbud.1130-ITLiMS');

const unknownRoom = parseUsosIcalEventLocation(
  '\nhttps://usosweb.usos.pw.edu.pl/kontroler.php?_action=katalog2/przedmioty/pokazZajecia',
  'Nowowiejska 24, 00-665 Warszawa'
);
assert.equal(unknownRoom.roomName, 'nieznana');
assert.equal(unknownRoom.additionalInfo, 'Sala nieznana');

assert.equal(
  formatPlanRoomLabel({ roomName: 'nieznana', type: 'USOS:ICAL', buildingName: 'bud.1130-ITLiMS' }),
  'Sala nieznana'
);
assert.equal(formatPlanRoomLabel({ roomName: 'ITLiMS-A2' }), 'Sala ITLiMS-A2');
assert.equal(formatPlanRoomLabel({ roomName: '', locationMode: 'Online' }), '');

assert.equal(
  sanitizePlanAdditionalInfo({
    type: 'USOS:ICAL',
    roomName: 'nieznana',
    buildingName: 'bud.1130-ITLiMS'
  }),
  'Sala nieznana\nbud.1130-ITLiMS'
);

assert.equal(
  sanitizePlanAdditionalInfo({
    type: 'USOS:ICAL',
    roomName: 'ITLiMS-A2',
    buildingName: 'bud.1130-ITLiMS',
    additionalInfo: 'https://example.com'
  }),
  'Sala: ITLiMS-A2\nbud.1130-ITLiMS'
);

assert.equal(shouldShowPlanOnlineLink({ type: 'USOS:ICAL', hangoutLink: 'https://usosweb.usos.pw.edu.pl/x' }), false);
assert.equal(
  shouldShowPlanOnlineLink({ type: 'MERITO:CLASS_SCHEDULE', hangoutLink: 'https://teams.microsoft.com/x' }),
  true
);

console.log('test-plan-event-info: ok');
