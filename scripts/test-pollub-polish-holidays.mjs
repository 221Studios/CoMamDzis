import assert from 'node:assert/strict';
import { easterSunday, isPolishPublicHoliday, polishPublicHolidayKeys } from '../src/pollubPolishHolidays.js';
import { toDateKey } from '../src/dateUtils.js';

const easter2026 = easterSunday(2026);
assert.equal(toDateKey(easter2026), '2026-04-05');

const corpusChristi2026 = new Date(easter2026);
corpusChristi2026.setDate(corpusChristi2026.getDate() + 60);
assert.equal(toDateKey(corpusChristi2026), '2026-06-04');
assert.equal(isPolishPublicHoliday(new Date(2026, 5, 4)), true);

assert.equal(isPolishPublicHoliday(new Date(2026, 5, 3)), false);
assert.equal(polishPublicHolidayKeys(2026).has('2026-05-01'), true);

console.log('pollub polish holidays tests passed');
