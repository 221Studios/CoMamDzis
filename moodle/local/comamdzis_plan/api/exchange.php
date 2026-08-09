<?php

define('AJAX_SCRIPT', true);
require_once(__DIR__ . '/../../../../config.php');

use local_comamdzis_plan\local\plan_finder;

header('Content-Type: application/json; charset=utf-8');

function local_comamdzis_plan_json_error(string $message, int $status = 400): void {
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

$raw = file_get_contents('php://input');
$body = json_decode($raw ?: '{}', true);
if (!is_array($body)) {
    local_comamdzis_plan_json_error('Invalid JSON body.');
}

$code = trim((string)($body['code'] ?? ''));
if ($code === '') {
    local_comamdzis_plan_json_error('Missing handoff code.');
}

$codehash = hash('sha256', $code);
$record = $DB->get_record('local_comamdzis_plan_codes', ['codehash' => $codehash]);
if (!$record || (int)$record->consumed === 1 || (int)$record->expires < time()) {
    local_comamdzis_plan_json_error('Handoff code expired or already used.', 401);
}

try {
    $items = plan_finder::list_plan_pdfs((int)$record->userid);
    $downloadtoken = bin2hex(random_bytes(32));
    $downloadhash = hash('sha256', $downloadtoken);
    $public = [];

    foreach ($items as $index => $item) {
        $public[] = [
            'filename' => $item['filename'],
            'courseid' => $item['courseid'],
            'course' => $item['course'],
            'module' => $item['module'],
            'score' => $item['score'],
            'downloadurl' => (new moodle_url('/local/comamdzis_plan/api/download.php', [
                'token' => $downloadtoken,
                'i' => $index,
            ]))->out(false),
        ];
    }

    $record->consumed = 1;
    $record->downloadhash = $downloadhash;
    $record->payload = json_encode($items);
    $record->expires = time() + 600;
    $DB->update_record('local_comamdzis_plan_codes', $record);

    echo json_encode([
        'ok' => true,
        'profile' => plan_finder::user_profile((int)$record->userid),
        'pdfs' => $public,
    ], JSON_UNESCAPED_UNICODE);
} catch (Throwable $exception) {
    local_comamdzis_plan_json_error('Could not list plan PDFs.', 500);
}
