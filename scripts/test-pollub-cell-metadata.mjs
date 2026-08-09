import assert from 'node:assert/strict';
import { parsePollubCellMetadata } from '../src/pollubCellMetadata.js';

const lecture = parsePollubCellMetadata(
  'Zaawansowane obróbki mechaniczne i erozyjne - W - dr inż. Agnieszka Skoczylas; M-XIV, 2t., w g. 10:00-12:00'
);
assert.equal(lecture.form, 'Wykład');
assert.equal(lecture.title, 'Zaawansowane obróbki mechaniczne i erozyjne');
assert.deepEqual(lecture.teachers, ['dr inż. Agnieszka Skoczylas']);

const project = parsePollubCellMetadata(
  'Technologie specjalne w procesach montażu - proj dr inż. Jakub Szabelski; R510, w g. 8:00-10:15, 6-10t.'
);
assert.equal(project.form, 'Projekt');
assert.deepEqual(project.teachers, ['dr inż. Jakub Szabelski']);

const lab = parsePollubCellMetadata(
  'Mechanika i fizyka ciała stałego - lab dr inż. Marcin Bocheński; R409, 1-8t. dr inż. Jarosław Gawryluk; R409, 9-15t.'
);
assert.equal(lab.form, 'Laboratorium');
assert.equal(lab.teachers.length, 2);

const exercises = parsePollubCellMetadata(
  'Wychowanie fizyczne - ćw - hala/basen, 1t., w g. 11:00-12:30'
);
assert.equal(exercises.form, 'Ćwiczenia');
assert.deepEqual(exercises.teachers, []);

const plainDr = parsePollubCellMetadata(
  'Analiza matematyczna z elementami statystyki - W - dr Magdalena Gregorczyk; M-XI'
);
assert.deepEqual(plainDr.teachers, ['dr Magdalena Gregorczyk']);

console.log('pollub cell metadata tests passed');
