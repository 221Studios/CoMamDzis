<?php

require_once(__DIR__ . '/../../../config.php');

require_login(null, false);

$redirecturi = optional_param('redirect_uri', 'comamdzis://wszip-moodle', PARAM_RAW_TRIMMED);
if (!preg_match('#^comamdzis://wszip-moodle#', $redirecturi)) {
    throw new moodle_exception('Invalid redirect URI');
}

$code = bin2hex(random_bytes(32));
$now = time();

$record = (object)[
    'codehash' => hash('sha256', $code),
    'downloadhash' => null,
    'userid' => (int)$USER->id,
    'payload' => null,
    'consumed' => 0,
    'timecreated' => $now,
    'expires' => $now + 600,
];
$DB->insert_record('local_comamdzis_plan_codes', $record);

$separator = strpos($redirecturi, '?') === false ? '?' : '&';
redirect($redirecturi . $separator . 'code=' . urlencode($code));
