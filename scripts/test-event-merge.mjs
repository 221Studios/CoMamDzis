import assert from 'node:assert/strict';
import {
  eventIdentity,
  hasEventDetails,
  mergeEnrichedEvents,
  mergeEventDetails,
  mergeScheduleWithExisting
} from '../src/eventMerge.js';

function sampleListEvent(overrides = {}) {
  return {
    id: '1',
    type: 'PLAN',
    title: 'Matematyka',
    start: '2026-03-10T08:00:00',
    end: '2026-03-10T09:30:00',
    color: '#0ea5e9',
    teacherNames: [],
    buildingName: '',
    buildingAddress: '',
    roomName: '',
    subject: '',
    additionalInfo: '',
    locationMode: '',
    hangoutLink: '',
    hangoutLinkLabel: '',
    ...overrides
  };
}

function sampleDetailedEvent(overrides = {}) {
  return sampleListEvent({
    teacherNames: ['Jan Kowalski'],
    buildingName: 'Budynek A',
    buildingAddress: 'ul. Testowa 1',
    roomName: '101',
    subject: 'Analiza',
    additionalInfo: 'Zabrać kalkulator',
    locationMode: 'Budynek',
    hangoutLink: '',
    hangoutLinkLabel: '',
    ...overrides
  });
}

assert.equal(
  eventIdentity(sampleListEvent()),
  '1|PLAN|2026-03-10T08:00:00|2026-03-10T09:30:00'
);

{
  const previous = [sampleDetailedEvent()];
  const incoming = [sampleListEvent({ title: 'Matematyka', start: '2026-03-10T08:00:00' })];
  const merged = mergeScheduleWithExisting(previous, incoming);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].teacherNames, ['Jan Kowalski']);
  assert.equal(merged[0].roomName, '101');
  assert.equal(merged[0].additionalInfo, 'Zabrać kalkulator');
}

{
  const previous = [sampleDetailedEvent({
    form: 'Laboratorium',
    groupName: 'Grupa A',
    module: 'Sieci komputerowe',
    title: 'Sieci komputerowe - laboratorium'
  })];
  const incoming = [sampleListEvent({
    form: '',
    groupName: '',
    id: '1',
    module: '',
    title: 'Sieci komputerowe'
  })];
  const merged = mergeScheduleWithExisting(previous, incoming);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].teacherNames, ['Jan Kowalski']);
  assert.equal(merged[0].buildingName, 'Budynek A');
  assert.equal(merged[0].roomName, '101');
  assert.equal(merged[0].form, 'Laboratorium');
  assert.equal(merged[0].groupName, 'Grupa A');
  assert.equal(merged[0].module, 'Sieci komputerowe');
}

{
  const previous = [sampleDetailedEvent({ hangoutLink: 'https://meet.example/a', hangoutLinkLabel: 'Meet', locationMode: 'Online' })];
  const incoming = [sampleListEvent()];
  const merged = mergeScheduleWithExisting(previous, incoming);
  assert.equal(merged[0].hangoutLink, 'https://meet.example/a');
  assert.equal(merged[0].hangoutLinkLabel, 'Meet');
  assert.equal(merged[0].locationMode, 'Online');
}

{
  const previous = [sampleDetailedEvent({ teacherNames: ['Stary Prowadzący'] })];
  const incoming = [sampleListEvent({ teacherNames: ['Nowy Prowadzący'] })];
  const merged = mergeScheduleWithExisting(previous, incoming);
  assert.deepEqual(merged[0].teacherNames, ['Nowy Prowadzący']);
}

{
  const current = [sampleDetailedEvent({ hangoutLink: 'https://meet.example/keep' })];
  const failedEnrich = [sampleListEvent()];
  const merged = mergeEnrichedEvents(current, failedEnrich);
  assert.equal(merged[0].hangoutLink, 'https://meet.example/keep');
  assert.deepEqual(merged[0].teacherNames, ['Jan Kowalski']);
}

{
  const current = [sampleDetailedEvent({ teacherNames: ['Jan Kowalski'] })];
  const enriched = [sampleListEvent({ teacherNames: ['Anna Nowak'], roomName: '202' })];
  const merged = mergeEnrichedEvents(current, enriched);
  assert.deepEqual(merged[0].teacherNames, ['Anna Nowak']);
  assert.equal(merged[0].roomName, '202');
}

{
  const merged = mergeEventDetails(null, sampleListEvent());
  assert.equal(merged.title, 'Matematyka');
  assert.equal(hasEventDetails(merged), false);
  assert.equal(hasEventDetails(sampleDetailedEvent()), true);
}

{
  const previous = [sampleDetailedEvent({ id: 'old' })];
  const incoming = [sampleListEvent({ id: 'new', title: 'Nowe zajęcia' })];
  const merged = mergeScheduleWithExisting(previous, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'new');
  assert.equal(merged[0].teacherNames.length, 0);
}

{
  const previous = [sampleDetailedEvent({
    type: 'MERITO:CLASS_SCHEDULE',
    status: 'moveTo',
    isCrossedOut: false,
    statusLabel: ''
  })];
  const incoming = [sampleListEvent({
    type: 'MERITO:CLASS_SCHEDULE',
    status: 'moveTo',
    isCrossedOut: false,
    statusLabel: ''
  })];
  const merged = mergeScheduleWithExisting(previous, incoming);
  assert.equal(merged[0].isCrossedOut, true);
  assert.equal(merged[0].statusLabel, 'Przeniesione');
}

console.log('test-event-merge: ok');
