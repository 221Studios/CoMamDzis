<?php

namespace local_comamdzis_plan\local;

defined('MOODLE_INTERNAL') || die();

class plan_finder {
    public static function user_profile(int $userid): array {
        global $DB;
        $user = $DB->get_record('user', ['id' => $userid], 'id,firstname,lastname,email', MUST_EXIST);
        return [
            'fullName' => fullname($user),
            'loginEmail' => (string)$user->email,
            'university' => 'WSZiP',
        ];
    }

    public static function list_plan_pdfs(int $userid): array {
        global $CFG;
        require_once($CFG->dirroot . '/enrol/externallib.php');
        require_once($CFG->dirroot . '/mod/resource/lib.php');

        $courses = enrol_get_users_courses($userid, true, 'id,shortname,fullname,visible');
        $items = [];

        foreach ($courses as $course) {
            try {
                $modinfo = get_fast_modinfo($course, $userid);
            } catch (\Throwable $exception) {
                continue;
            }

            foreach ($modinfo->get_cms() as $cm) {
                if (!$cm->uservisible || $cm->modname !== 'resource') {
                    continue;
                }

                $context = \context_module::instance($cm->id, IGNORE_MISSING);
                if (!$context) {
                    continue;
                }

                $fs = get_file_storage();
                $files = $fs->get_area_files($context->id, 'mod_resource', 'content', 0, 'filename', false);
                foreach ($files as $file) {
                    if (strtolower($file->get_mimetype()) !== 'application/pdf' && !preg_match('/\.pdf$/i', $file->get_filename())) {
                        continue;
                    }
                    $label = $cm->name . ' ' . $file->get_filename() . ' ' . $course->fullname;
                    $score = self::score_pdf($label);
                    if ($score <= 0) {
                        continue;
                    }
                    $items[] = [
                        'filename' => $file->get_filename(),
                        'courseid' => (int)$course->id,
                        'course' => format_string($course->fullname),
                        'module' => format_string($cm->name),
                        'score' => $score,
                        'file' => [
                            'contextid' => (int)$context->id,
                            'component' => 'mod_resource',
                            'filearea' => 'content',
                            'itemid' => 0,
                            'filepath' => $file->get_filepath(),
                            'filename' => $file->get_filename(),
                        ],
                    ];
                }
            }
        }

        usort($items, static function (array $a, array $b): int {
            return ($b['score'] <=> $a['score']) ?: strcmp($a['filename'], $b['filename']);
        });

        return $items;
    }

    private static function score_pdf(string $label): int {
        $text = \core_text::strtolower($label);
        $score = 0;
        foreach (['plan', 'plany', 'zajec', 'zajęć', 'rozklad', 'rozkład', 'harmonogram'] as $needle) {
            if (strpos($text, $needle) !== false) {
                $score += 25;
            }
        }
        foreach (['pdf', '.pdf'] as $needle) {
            if (strpos($text, $needle) !== false) {
                $score += 5;
            }
        }
        return $score;
    }
}
