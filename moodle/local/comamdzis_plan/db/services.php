<?php

defined('MOODLE_INTERNAL') || die();

$functions = [
    'local_comamdzis_plan_get_plan_pdfs' => [
        'classname' => 'local_comamdzis_plan\\external\\get_plan_pdfs',
        'methodname' => 'execute',
        'description' => 'Return PDF plan candidates visible to the current Moodle user.',
        'type' => 'read',
        'ajax' => false,
        'services' => [MOODLE_OFFICIAL_MOBILE_SERVICE],
    ],
];
