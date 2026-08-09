const MERITO_RESCHEDULED_STATUSES = new Set(['moveFrom', 'moveTo', 'moveToWithoutDate']);

export function isMeritoCrossedOutStatus(status) {
  return isMeritoRescheduledStatus(status);
}

export function isMeritoRescheduledStatus(status) {
  return MERITO_RESCHEDULED_STATUSES.has(String(status || '').trim());
}

export function meritoStatusLabel(status) {
  const value = String(status || '').trim();
  if (value === 'moveFrom') return 'Odwołone w tym terminie';
  if (value === 'moveTo') return 'Przeniesione';
  if (value === 'moveToWithoutDate') return 'Przeniesione (bez daty)';
  return '';
}

export function resolveMeritoEventPresentation(status, extras = {}) {
  const value = String(status || '').trim();
  const isCrossedOut = isMeritoCrossedOutStatus(value);
  const isRescheduled = isMeritoRescheduledStatus(value);
  const statusLabel = meritoStatusLabel(value);
  const notes = [];

  if (extras.reasonOfRescheduled) notes.push(String(extras.reasonOfRescheduled).trim());
  if (extras.finalMovedFrom) notes.push(`Poprzedni termin: ${extras.finalMovedFrom}`);
  if (extras.finalMovedTo) notes.push(`Nowy termin: ${extras.finalMovedTo}`);

  return {
    isCrossedOut,
    isRescheduled,
    statusLabel,
    rescheduleNotes: notes.filter(Boolean).join('\n')
  };
}

export function isMeritoScheduleEvent(event) {
  return String(event?.type || '').startsWith('MERITO:');
}

export function isEventCrossedOut(event) {
  if (!event) return false;
  if (isMeritoScheduleEvent(event)) {
    return isMeritoCrossedOutStatus(event.status) || Boolean(event.isCrossedOut);
  }
  return Boolean(event.isCrossedOut);
}

export function eventStatusLabel(event) {
  const label = String(event?.statusLabel || '').trim();
  if (label) return label;
  return meritoStatusLabel(event?.status);
}

export function refreshMeritoEventFields(event) {
  if (!isMeritoScheduleEvent(event)) return event;
  const presentation = resolveMeritoEventPresentation(event.status);
  return {
    ...event,
    isCrossedOut: presentation.isCrossedOut,
    isRescheduled: presentation.isRescheduled,
    statusLabel: presentation.statusLabel || event.statusLabel || ''
  };
}

export function refreshMeritoEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.map(refreshMeritoEventFields);
}
