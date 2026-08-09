import assert from 'node:assert/strict';
import {
  buildEventText,
  filterConflictingStudentEvents,
  formMatchesColumn,
  normalizeKindFromTitle,
  parseExplicitTimes,
  parsePdfItemsToEvents,
  parsePdfItemsToWeeklyTemplates,
  resolveDisplayGroup,
  resolveTimesFromSlotSpan,
  semesterWeekIndex,
  studentMatchesPdfColumn,
  studentMatchesPdfColumnExact
} from '../src/pollubWeeklyGridParser.js';
import { normalizeRoomText, parsePollubRoomLocation as parseRoom } from '../src/pollubRoomParser.js';

assert.equal(
  resolveDisplayGroup({
    form: 'Wykład',
    kind: 'W',
    columnCode: 'GLA02',
    studentGroups: ['GLA02', 'GWY01']
  }),
  'GWY01'
);

assert.equal(
  resolveDisplayGroup({
    form: 'Ćwiczenia',
    kind: 'CW',
    columnCode: 'GCW01',
    studentGroups: ['GLA02', 'GCW01', 'GWY01']
  }),
  'GCW01'
);

assert.equal(
  resolveDisplayGroup({
    form: 'Projekt',
    kind: 'PROJ',
    columnCode: 'GLA02',
    studentGroups: ['GLA02', 'GPR02', 'GWY01']
  }),
  'GPR02'
);

assert.equal(
  resolveDisplayGroup({
    form: 'Laboratorium',
    kind: 'LAB',
    columnCode: 'GLA02',
    studentGroups: ['GLA02', 'GWY01']
  }),
  'GLA02'
);

const pkmRoom = parseRoom(
  'Podstawy konstrukcji maszyn - W - dr inż. Jan Kowalski; M - IV, 2t.'
);
assert.equal(pkmRoom.roomName, 'M-IV');
assert.equal(pkmRoom.buildingName, 'Wydział Mechaniczny');

const englishRoom = parseRoom(
  'Język angielski - W - dr Anna Nowak; CENTECH 302, 2t., w g. 12:00-14:00'
);
assert.equal(englishRoom.roomName, 'CENTECH 302');
assert.equal(englishRoom.buildingName, 'Centrum Technologii');

const metrologyRoom = parseRoom('Metrologia wielkości - lab - dr X; E320, 1t.');
assert.equal(metrologyRoom.roomName, 'E320');

const ciRoom = parseRoom('Przedmiot - W - dr Y; CI 101, 2t.');
assert.equal(ciRoom.roomName, 'CI 101');
assert.equal(ciRoom.buildingName, 'CI');

assert.equal(normalizeRoomText('M - VII'), 'M-VII');

const builtText = buildEventText([
  { text: 'Podstawy konstrukcji maszyn - W - dr X;', x: 120, y: 500 },
  { text: 'M', x: 200, y: 488 },
  { text: '- IV, 2t.', x: 210, y: 488 }
]);
assert.match(builtText, /M-IV|M - IV/i);

assert.deepEqual(parseExplicitTimes('coś; sala, w g. 10:30-12:00'), {
  start: '10:30',
  end: '12:00'
});

const timeSlots = [
  { start: '08:00', end: '09:00', y: 700, label: '8-9' },
  { start: '09:00', end: '10:00', y: 680, label: '9-10' },
  { start: '10:00', end: '11:00', y: 660, label: '10-11' }
];

const twoHourCell = {
  day: { key: 'WTOREK' },
  columnCode: 'GLA02',
  slot: timeSlots[0],
  parts: [
    { text: 'Podstawy konstrukcji maszyn - W - dr X; M-IV', x: 150, y: 700 },
    { text: 'kontynuacja', x: 150, y: 682 }
  ]
};

const twoHourTimes = resolveTimesFromSlotSpan(twoHourCell, timeSlots, twoHourCell.parts[0].text, new Map());
assert.equal(twoHourTimes.start, '08:00');
assert.equal(twoHourTimes.end, '10:00');

const occupied = new Map([['WTOREK|GLA02', new Set(['08:00'])]]);
const singleSlotCell = {
  day: { key: 'WTOREK' },
  columnCode: 'GLA02',
  slot: timeSlots[0],
  parts: [{ text: 'Przedmiot - W - dr X; M-IV', x: 150, y: 700 }]
};
const extendedTimes = resolveTimesFromSlotSpan(
  singleSlotCell,
  timeSlots,
  singleSlotCell.parts[0].text,
  occupied
);
assert.equal(extendedTimes.start, '08:00');
assert.equal(extendedTimes.end, '10:00');

const mondaySlots = [
  { start: '08:00', end: '09:00', y: 881, label: '8-9' },
  { start: '09:00', end: '10:00', y: 864, label: '9-10' },
  { start: '10:00', end: '11:00', y: 847, label: '10-11' },
  { start: '18:00', end: '19:00', y: 904, label: '18-19' },
  { start: '19:00', end: '20:00', y: 894, label: '19-20' }
];
const pkmCwCell = {
  day: { key: 'PONIEDZIAŁEK' },
  columnCode: 'GCW01',
  slot: mondaySlots[0],
  parts: [
    { text: 'Podstawy konstrukcji maszyn - ćw -', x: 170, y: 877 },
    { text: 'dr inż. Grzegorz Ponieważ, profesor uczelni; M-IV', x: 148, y: 869 }
  ]
};
const pkmCwTimes = resolveTimesFromSlotSpan(
  pkmCwCell,
  mondaySlots,
  'Podstawy konstrukcji maszyn - ćw - dr inż. Grzegorz Ponieważ; M-IV',
  new Map(),
  mondaySlots
);
assert.equal(pkmCwTimes.start, '08:00');
assert.equal(pkmCwTimes.end, '09:00');

assert.equal(normalizeKindFromTitle('Mechanika - W - dr X'), 'W');
assert.equal(normalizeKindFromTitle('Coś - proj dr X'), 'PROJ');

const lectureConflict = filterConflictingStudentEvents(
  [
    {
      start: '2026-06-01T10:30:00',
      end: '2026-06-01T12:00:00',
      title: 'Wyklad test',
      form: 'Wykład',
      module: 'GLA02'
    },
    {
      start: '2026-06-01T10:30:00',
      end: '2026-06-01T12:00:00',
      title: 'Wyklad test',
      form: 'Wykład',
      module: 'GWY01'
    }
  ],
  ['GLA02', 'GWY01']
);
assert.equal(lectureConflict.length, 1);
assert.equal(lectureConflict[0].module, 'GWY01');

const pkmMergedRoom = parseRoom(
  'Podstawy konstrukcji maszyn - ćw - dr inż. Grzegorz Ponieważ, profesor uczelni; M-IV'
);
assert.equal(pkmMergedRoom.roomName, 'M-IV');

assert.deepEqual(parseExplicitTimes('Podstawy elektroniki - lab tyg. 2-11 14.45 - 17.00'), {
  start: '14:45',
  end: '17:00'
});

const elektronikaText = buildEventText([
  { text: 'Podstawy elektroniki - lab tyg. 2-11', x: 281, y: 338 },
  { text: '14.45 - 17.00', x: 312, y: 330 },
  { text: 'mgr inż. Żaklin Grądz; E306', x: 291, y: 322 }
]);
assert.match(elektronikaText, /14\.45\s*-\s*17\.00/);
assert.deepEqual(parseExplicitTimes(elektronikaText), { start: '14:45', end: '17:00' });

const semStart = new Date(2026, 1, 1);
assert.equal(semesterWeekIndex(new Date(2026, 5, 4), semStart), 18);

const weekFiltered = parsePdfItemsToEvents(
  [],
  ['GLA02'],
  '2026-02-01',
  '2026-09-01',
  '2026-02-01'
);
assert.equal(weekFiltered.length, 0);

const weekTemplatesOnly = parsePdfItemsToEvents(
  [
    {
      page: 1,
      text: 'Podstawy elektroniki - lab tyg. 2-11',
      x: 281,
      y: 338
    },
    {
      page: 1,
      text: '14.45 - 17.00',
      x: 312,
      y: 330
    },
    { page: 1, text: 'CZWARTEK', x: 87, y: 357 },
    { page: 1, text: 'GLA02', x: 319, y: 1053 },
    { page: 1, text: '15 - 16', x: 98, y: 329 },
    { page: 1, text: '16 - 17', x: 98, y: 309 },
    { page: 1, text: 'PONIEDZIAŁEK', x: 87, y: 945 },
    { page: 1, text: 'WTOREK', x: 87, y: 782 },
    { page: 1, text: 'ŚRODA', x: 87, y: 580 },
    { page: 1, text: 'PIĄTEK', x: 87, y: 164 }
  ],
  ['GLA02'],
  '2026-02-01',
  '2026-09-01',
  '2026-02-01'
);
const juneThursday = weekTemplatesOnly.filter((event) => event.start.startsWith('2026-06-04'));
assert.equal(juneThursday.length, 0, 'tyg. 2-11 nie powinno pokazywać się w 18. tygodniu semestru');

const holidaySkip = parsePdfItemsToEvents(
  [
    {
      page: 1,
      text: 'Przedmiot - W - dr X; sala',
      x: 281,
      y: 338
    },
    { page: 1, text: 'CZWARTEK', x: 87, y: 357 },
    { page: 1, text: 'GLA02', x: 319, y: 1053 },
    { page: 1, text: '15 - 16', x: 98, y: 329 },
    { page: 1, text: 'PONIEDZIAŁEK', x: 87, y: 945 },
    { page: 1, text: 'WTOREK', x: 87, y: 782 },
    { page: 1, text: 'ŚRODA', x: 87, y: 580 },
    { page: 1, text: 'PIĄTEK', x: 87, y: 164 }
  ],
  ['GLA02'],
  '2026-06-01',
  '2026-06-08',
  '2026-02-01'
);
assert.equal(
  holidaySkip.some((event) => event.start.startsWith('2026-06-04')),
  false,
  'Boże Ciało 2026-06-04 nie powinno mieć zajęć'
);

const metrologyCrossColumn = parsePdfItemsToWeeklyTemplates(
  [
    { page: 1, text: 'Metrologia wielkości elektrycznych - lab', x: 274, y: 384 },
    { page: 1, text: 'mgr inż. Ernest Przychodzki; E320', x: 282, y: 376 },
    { page: 1, text: '12.15 - 14.30', x: 175, y: 370 },
    { page: 1, text: 'mgr inż. Żaklin Grądz; E306', x: 154, y: 362 },
    { page: 1, text: 'CZWARTEK', x: 87, y: 357 },
    { page: 1, text: 'GLA01', x: 182, y: 1053 },
    { page: 1, text: 'GCW01', x: 215, y: 1053 },
    { page: 1, text: 'GLA02', x: 319, y: 1053 },
    { page: 1, text: '12 - 13', x: 98, y: 389 },
    { page: 1, text: '13 - 14', x: 98, y: 369 },
    { page: 1, text: 'PONIEDZIAŁEK', x: 87, y: 945 },
    { page: 1, text: 'WTOREK', x: 87, y: 782 },
    { page: 1, text: 'ŚRODA', x: 87, y: 580 },
    { page: 1, text: 'PIĄTEK', x: 87, y: 164 }
  ],
  ['GCW01', 'GLA02']
);
const metrologyLab = metrologyCrossColumn.find(
  (template) => template.title.includes('Metrologia') && template.columnCode === 'GLA02'
);
assert.ok(metrologyLab, 'metrologia GLA02 powinna być w planie');
assert.equal(metrologyLab.startTime, '12:00');
assert.equal(metrologyLab.endTime, '14:00');
assert.equal(metrologyLab.roomName, 'E320');
assert.equal(
  metrologyCrossColumn.some((template) => template.title.includes('Grądz')),
  false,
  'wiersze z GCW01 nie powinny zanieczyszczać metrologii GLA02'
);

assert.equal(formMatchesColumn('Ćwiczenia', 'CW', 'GLA02'), false);
assert.equal(formMatchesColumn('Ćwiczenia', 'CW', 'GCW01'), true);
assert.equal(formMatchesColumn('Wykład', 'W', 'GLA02'), true);
assert.equal(formMatchesColumn('Laboratorium', 'LAB', 'GLA02'), true);

assert.equal(studentMatchesPdfColumn('GWY01', 'GWY01'), true);
assert.equal(studentMatchesPdfColumn('GCW01', 'GCW02'), true);
assert.equal(studentMatchesPdfColumnExact('GCW01', 'GCW02'), false);
assert.equal(studentMatchesPdfColumnExact('GCW01', 'GCW01'), true);
assert.equal(studentMatchesPdfColumnExact('GWY01', 'GLA02'), false);

console.log('pollub weekly grid tests passed');
