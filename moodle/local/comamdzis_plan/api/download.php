<?php

require_once(__DIR__ . '/../../../../config.php');

$token = required_param('token', PARAM_ALPHANUMEXT);
$index = required_param('i', PARAM_INT);

$downloadhash = hash('sha256', $token);
$record = $DB->get_record('local_comamdzis_plan_codes', ['downloadhash' => $downloadhash]);
if (!$record || (int)$record->expires < time()) {
    throw new moodle_exception('Download token expired.');
}

$items = json_decode((string)$record->payload, true);
if (!is_array($items) || !isset($items[$index]['file'])) {
    throw new moodle_exception('PDF not found.');
}

$fileinfo = $items[$index]['file'];
$fs = get_file_storage();
$file = $fs->get_file(
    (int)$fileinfo['contextid'],
    (string)$fileinfo['component'],
    (string)$fileinfo['filearea'],
    (int)$fileinfo['itemid'],
    (string)$fileinfo['filepath'],
    (string)$fileinfo['filename']
);

if (!$file || $file->is_directory()) {
    throw new moodle_exception('PDF file missing.');
}

send_stored_file($file, 0, 0, true, ['filename' => $file->get_filename()]);
