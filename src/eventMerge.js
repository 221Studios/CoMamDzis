import { refreshMeritoEvents } from './meritoEventStatus.js';

export const EVENT_DETAIL_FIELDS = [
  'module',
  'form',
  'groupName',
  'teacherNames',
  'teacherName',
  'buildingName',
  'buildingAddress',
  'roomName',
  'subject',
  'additionalInfo',
  'locationMode',
  'hangoutLink',
  'hangoutLinkLabel'
];

export function eventIdentity(event) {
  if (!event) return '';

  const stableId = [
    event.termId,
    event.egsamTermId,
    event.meetingTermId,
    event.id
  ].find((value) => !isEmptyDetailValue(value));

  if (stableId) {
    return [stableId, event.type, event.start, event.end].filter(Boolean).join('|');
  }

  return [event.type, event.start, event.end, event.title].filter(Boolean).join('|');
}

export function isEmptyDetailValue(value) {
  if (Array.isArray(value)) return !value.length;
  return !String(value || '').trim();
}

export function hasEventDetails(event) {
  if (!event) return false;
  return EVENT_DETAIL_FIELDS.some((field) => !isEmptyDetailValue(event[field]));
}

export function mergeEventDetails(existing, incoming) {
  if (!incoming) return existing || null;
  if (!existing) return incoming;

  const merged = { ...incoming };
  for (const field of EVENT_DETAIL_FIELDS) {
    if (isEmptyDetailValue(incoming[field]) && !isEmptyDetailValue(existing[field])) {
      merged[field] = existing[field];
    }
  }
  return merged;
}

export function mergeScheduleWithExisting(previousEvents, incomingEvents) {
  const previousById = new Map(previousEvents.map((event) => [eventIdentity(event), event]));
  return refreshMeritoEvents(
    incomingEvents.map((incoming) =>
      mergeEventDetails(previousById.get(eventIdentity(incoming)), incoming)
    )
  );
}

export function mergeEnrichedEvents(current, enriched) {
  const enrichedById = new Map(enriched.map((event) => [eventIdentity(event), event]));
  return refreshMeritoEvents(
    current.map((event) => {
      const patch = enrichedById.get(eventIdentity(event));
      if (!patch) return event;
      return mergeEventDetails(event, patch);
    })
  );
}
