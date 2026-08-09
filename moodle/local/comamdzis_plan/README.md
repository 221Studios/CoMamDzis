# local_comamdzis_plan

Moodle local plugin for Comamdziś WSZiP plan handoff.

Część integracji **WSZiP** w aplikacji CoMamDziś (wersja 0.1.23). Pełna lista obsługiwanych uczelni: `lista_uczelni_obslugiwane.txt` w katalogu głównym repozytorium.

## Purpose

This plugin makes the mobile flow possible without using an embedded WebView for Google login:

1. The app opens `/local/comamdzis_plan/start.php` in the system browser.
2. Moodle handles the normal Google login.
3. After the user is authenticated, the plugin creates a one-time handoff code.
4. Moodle redirects to `comamdzis://wszip-moodle?code=...`.
5. The app exchanges the code at `/local/comamdzis_plan/api/exchange.php`.
6. The app receives ranked PDF plan candidates and downloads the best PDF through a short-lived `/api/download.php` URL.

The app never reads browser cookies and never runs Google login inside WebView.

## Install

Copy this directory to the Moodle server as:

```text
local/comamdzis_plan
```

Then run Moodle upgrade from the admin panel or CLI:

```bash
php admin/cli/upgrade.php
```

## Endpoint

Start URL used by the app:

```text
https://mdl.wszip.poznan.pl/local/comamdzis_plan/start.php?redirect_uri=comamdzis://wszip-moodle
```

## Web service function

The plugin also exposes:

```text
local_comamdzis_plan_get_plan_pdfs
```

This function is for diagnostics/admin token setups. The mobile handoff flow uses `start.php`, `api/exchange.php`, and `api/download.php`.
