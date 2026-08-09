const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
export const MONTHS_LONG = [
  'Styczeń',
  'Luty',
  'Marzec',
  'Kwiecień',
  'Maj',
  'Czerwiec',
  'Lipiec',
  'Sierpień',
  'Wrzesień',
  'Październik',
  'Listopad',
  'Grudzień'
];

export function pad2(value) {
  return String(value).padStart(2, '0');
}

export function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatLocalDateTimeFromParts(year, month, day, hours, minutes) {
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hours)}:${pad2(minutes)}:00`;
}

export function formatLocalDateTimeFromPolish(dateStr, timeStr) {
  const [day, month, year] = String(dateStr || '').split('.').map(Number);
  const [hours, minutes] = String(timeStr || '').split(':').map(Number);
  return formatLocalDateTimeFromParts(year, month, day, hours, minutes);
}

export function focusRangeForEvents(events, anchorDate, mode) {
  if (!Array.isArray(events) || !events.length) return null;

  const rangeStart = startForMode(anchorDate, mode);
  const rangeEnd = endExclusiveForMode(anchorDate, mode);
  const hasVisible = events.some((event) => {
    const start = new Date(event.start);
    return start >= rangeStart && start < rangeEnd;
  });

  if (hasVisible) return null;

  const first = new Date(events[0].start);
  return {
    anchorDate: new Date(first.getFullYear(), first.getMonth(), 1),
    mode: 'month'
  };
}

/** Dzień najbliższych zajęć od podanej daty (włącznie z tym dniem), tryb „Dziś”. */
export function nearestUpcomingEventFocus(events, fromDate = new Date()) {
  if (!Array.isArray(events) || !events.length) return null;

  const from = startOfDay(fromDate);
  let nearest = null;
  let nearestTime = Infinity;

  for (const event of events) {
    const start = new Date(event.start);
    if (start < from) continue;
    const time = start.getTime();
    if (time < nearestTime) {
      nearestTime = time;
      nearest = start;
    }
  }

  const focusStart = nearest
    ?? events.reduce((latest, event) => {
      const start = new Date(event.start);
      return start > latest ? start : latest;
    }, new Date(events[0].start));

  return {
    anchorDate: startOfDay(focusStart),
    mode: 'today'
  };
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfWeek(date) {
  const current = startOfDay(date);
  const day = current.getDay() === 0 ? 7 : current.getDay();
  return addDays(current, 1 - day);
}

export function endExclusiveForMode(date, mode) {
  if (mode === 'today') return addDays(startOfDay(date), 1);
  if (mode === 'week') return addDays(startOfWeek(date), 7);
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

export function startForMode(date, mode) {
  if (mode === 'today') return startOfDay(date);
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function semesterRangeForDate(date) {
  const month = date.getMonth();
  const year = date.getFullYear();

  if (month >= 9) {
    const start = new Date(year, 9, 1);
    const end = new Date(year + 1, 2, 1);
    return {
      start,
      end,
      startKey: toDateKey(start),
      endKey: toDateKey(end)
    };
  }

  if (month <= 1) {
    const start = new Date(year - 1, 9, 1);
    const end = new Date(year, 2, 1);
    return {
      start,
      end,
      startKey: toDateKey(start),
      endKey: toDateKey(end)
    };
  }

  const start = new Date(year, 1, 1);
  const end = new Date(year, 8, 1);
  return {
    start,
    end,
    startKey: toDateKey(start),
    endKey: toDateKey(end)
  };
}

export function dateLabel(date) {
  return new Intl.DateTimeFormat('pl-PL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long'
  }).format(date);
}

export function rangeTitle(start, endExclusive, mode) {
  if (mode === 'today') return dateLabel(start);
  if (mode === 'month') {
    const monthName = MONTHS_LONG[start.getMonth()];
    return start.getFullYear() === new Date().getFullYear() ? monthName : `${monthName} ${start.getFullYear()}`;
  }
  const endInclusive = addDays(endExclusive, -1);
  return `${new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: 'short' }).format(start)} - ${new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' }).format(endInclusive)}`;
}

export function buildMonthSliderItems(start, endExclusive) {
  const items = [];
  let current = new Date(start.getFullYear(), start.getMonth(), 1);
  const end = new Date(endExclusive.getFullYear(), endExclusive.getMonth(), 1);
  let lastYear = null;

  while (current < end) {
    const year = current.getFullYear();
    if (year !== lastYear) {
      items.push({ type: 'year', year });
      lastYear = year;
    }
    items.push({ type: 'month', date: new Date(current) });
    current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  }

  return items;
}

export function buildMonthSliderItemsAround(centerDate, yearsBefore = 25, yearsAfter = 25) {
  const start = new Date(centerDate.getFullYear() - yearsBefore, 0, 1);
  const end = new Date(centerDate.getFullYear() + yearsAfter + 1, 0, 1);
  return buildMonthSliderItems(start, end);
}

export function eventDateKey(event) {
  return toDateKey(new Date(event.start));
}

export function eventTimeRange(event) {
  const fmt = new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit'
  });
  return `${fmt.format(new Date(event.start))} - ${fmt.format(new Date(event.end))}`;
}

export function groupEventsByDay(events) {
  return events.reduce((days, event) => {
    const key = eventDateKey(event);
    if (!days[key]) days[key] = [];
    days[key].push(event);
    return days;
  }, {});
}

export function daysBetween(start, endExclusive) {
  const days = [];
  const count = Math.max(1, Math.round((startOfDay(endExclusive) - startOfDay(start)) / MS_PER_DAY));
  for (let i = 0; i < count; i += 1) {
    days.push(addDays(start, i));
  }
  return days;
}
