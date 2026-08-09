import {
  isEventCrossedOut,
  isMeritoCrossedOutStatus,
  meritoStatusLabel,
  refreshMeritoEventFields,
  resolveMeritoEventPresentation
} from '../src/meritoEventStatus.js';

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    failed += 1;
  } else {
    console.log('OK:', message);
  }
}

assert(isMeritoCrossedOutStatus('moveFrom'), 'moveFrom is crossed out');
assert(isMeritoCrossedOutStatus('moveTo'), 'moveTo is crossed out');
assert(isMeritoCrossedOutStatus('moveToWithoutDate'), 'moveToWithoutDate is crossed out');
assert(!isMeritoCrossedOutStatus('planned'), 'planned is not crossed out');
assert(meritoStatusLabel('moveFrom') === 'Odwołone w tym terminie', 'moveFrom label');
assert(meritoStatusLabel('moveTo') === 'Przeniesione', 'moveTo label');

const presentation = resolveMeritoEventPresentation('moveFrom', {
  reasonOfRescheduled: 'Zmiana terminu',
  finalMovedTo: '2026-06-20 10:00'
});
assert(presentation.isCrossedOut, 'presentation crossed out');
assert(presentation.statusLabel === 'Odwołone w tym terminie', 'presentation label');
assert(presentation.rescheduleNotes.includes('Zmiana terminu'), 'presentation notes');

const movedPresentation = resolveMeritoEventPresentation('moveTo', {
  finalMovedTo: '7400a6e1-0360-4972-af4f-861607ea24ad'
});
assert(movedPresentation.isCrossedOut, 'moveTo presentation crossed out');
assert(movedPresentation.statusLabel === 'Przeniesione', 'moveTo presentation label');

const staleCacheEvent = {
  id: '7836a816-7f55-4788-947f-a397e9220d91',
  type: 'MERITO:CLASS_SCHEDULE',
  title: 'Komunikacja marketingowa',
  status: 'moveTo',
  isCrossedOut: false,
  statusLabel: ''
};
assert(isEventCrossedOut(staleCacheEvent), 'stale cache event crossed out from status');
const refreshed = refreshMeritoEventFields(staleCacheEvent);
assert(refreshed.isCrossedOut, 'refresh fixes stale isCrossedOut');
assert(refreshed.statusLabel === 'Przeniesione', 'refresh fixes stale statusLabel');

if (failed) process.exit(1);
