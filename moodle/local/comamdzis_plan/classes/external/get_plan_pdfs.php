<?php

namespace local_comamdzis_plan\external;

use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_multiple_structure;
use core_external\external_single_structure;
use core_external\external_value;
use local_comamdzis_plan\local\plan_finder;

class get_plan_pdfs extends external_api {
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([]);
    }

    public static function execute(): array {
        global $USER;
        $context = \context_user::instance($USER->id);
        self::validate_context($context);

        $items = plan_finder::list_plan_pdfs((int)$USER->id);
        return array_map(static function (array $item): array {
            return [
                'filename' => $item['filename'],
                'courseid' => $item['courseid'],
                'course' => $item['course'],
                'module' => $item['module'],
                'score' => $item['score'],
            ];
        }, $items);
    }

    public static function execute_returns(): external_multiple_structure {
        return new external_multiple_structure(
            new external_single_structure([
                'filename' => new external_value(PARAM_TEXT, 'PDF filename'),
                'courseid' => new external_value(PARAM_INT, 'Moodle course id'),
                'course' => new external_value(PARAM_TEXT, 'Course fullname'),
                'module' => new external_value(PARAM_TEXT, 'Resource module name'),
                'score' => new external_value(PARAM_INT, 'Plan match score'),
            ])
        );
    }
}
