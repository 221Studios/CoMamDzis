# CoMamDziś

Androidowa aplikacja do szybkiego sprawdzania planu zajęć bez wchodzenia za każdym razem przez przeglądarkę.

Aktualna wersja: **0.1.29**

## Obsługiwane uczelnie

Aplikacja obsługuje **7 typów integracji**. Uczelnia jest wykrywana automatycznie po loginie lub adresie e-mail.

### Integracje dedykowane

| Uczelnia | System | Jak rozpoznać login |
|---|---|---|
| **Collegium Da Vinci** | Wirtualna Uczelnia (`wu.cdv.pl`) | `@edu.cdv.pl`, `@cdv.pl` |
| **Uniwersytet WSB Merito** | Merito Go | domeny `merito.pl` / `wsb.pl`, krótkie loginy studenckie |
| **WSZiP** | Moodle + plan PDF | domeny `wszip.pl`, `wszip.poznan.pl` |
| **Politechnika Lubelska** | eHMS + plan PDF wydziału | login 6-cyfrowy, `ehms.pollub`, `pollub.edu.pl` |
| **WSEIT** | Wirtualny Dziekanat (`wd.wseit.pl`) | krótki login (np. `zk40`), domeny `wseit.pl` |

### USOS — 67 zweryfikowanych uczelni

Większość polskich uczelni publicznych i wielu prywatnych korzysta z systemu **USOS**. Aplikacja rozpoznaje uczelnię po domenie e-maila studenckiego lub po linku iCal z USOSweb. Lista USOS zawiera instalacje potwierdzone probe logowania do etapu odrzucenia syntetycznych błędnych danych.

Wyróżnione w interfejsie (logo w UI):

- Politechnika Warszawska (PW)
- Uniwersytet Jagielloński (UJ)
- UMCS w Lublinie

Pełna lista uczelni USOS: `lista_usos_kompletna.txt`.
Pełna lista wszystkich obsługiwanych uczelni (72): `lista_uczelni_obslugiwane.txt`.

Masowa weryfikacja portali USOS:

```bash
npm run discover:usos-official
npm run test:usos-registry
npm run test:usos-login-probe
npm run probe:usos-logins
```

`probe:usos-logins` domyślnie sprawdza mapowanie z rejestru, odpowiedź portalu, endpoint API z `apiBaseUrl` oraz dojście do formularza logowania CAS/logowania bez wysyłania danych. Jeśli trzeba potwierdzić pełny etap wpisania syntetycznego loginu i hasła `test` oraz naciśnięcia loginu:

```bash
npm run probe:usos-logins -- --submit-invalid-login --concurrency 2
```

Skrypt generuje nieistniejący login per uczelnia (`comamdzi_probe.<id>@<domena>`) i oczekuje komunikatu typu „nieprawidłowy login lub hasło”. Dla IdP renderowanych JavaScriptem, np. Microsoft Entra, użyj fallbacku browserowego:

```bash
npm run probe:usos-logins:browser -- --only sgh-waw-pl,tyszkiewicz-edu-pl,uni-lodz-pl
```

Raport JSON/Markdown trafia do ignorowanego katalogu `scripts/.usos-login-probe/`.

### Wojskowa Akademia Techniczna (WAT)

WAT jest obsługiwana przez dedykowaną integrację z planami Plansoft na stronach wydziałów (`wat.edu.pl`), niezależnie od wpisu w rejestrze USOS.

## Co robi aplikacja

- loguje się do właściwego systemu uczelni (lub pobiera plan z iCal / PDF, zależnie od integracji),
- nie przechodzi dalej po błędnym loginie lub haśle,
- pozwala zapamiętać profil i później zalogować się jednym kliknięciem z listy zapisanych kont,
- przy pierwszym logowaniu pobiera plan dostępny dla aktualnego semestru,
- zapisuje plan lokalnie, żeby kolejne uruchomienia były szybkie,
- pokazuje widok `Dziś` i `Miesiąc`,
- automatycznie synchronizuje plan w tle po starcie, po powrocie do aplikacji i cyklicznie podczas używania,
- pokazuje popup, gdy pojawią się nowe zajęcia albo gdy zajęcia znikną z planu,
- pokazuje szczegóły zajęć: tryb, salę, budynek/adres, prowadzącego, przedmiot, grupę, opis i link online, jeśli system uczelni je zwróci,
- ma ustawienia w prawym górnym rogu: wylogowanie, przełącznik jasnego/ciemnego motywu oraz skróty do portalu uczelni.

## Instalacja APK

Gotowa paczka znajduje się w repozytorium jako plik z numerem wersji:

```text
CDV-Plan-0.1.29.apk
```

Na telefonie z Androidem trzeba pozwolić na instalowanie aplikacji z nieznanych źródeł, a potem uruchomić plik APK.

Jeśli aktualizacja nie chce zainstalować się na poprzednią wersję, odinstaluj starą aplikację i zainstaluj APK ponownie.

## Uruchomienie projektu lokalnie

Projekt jest zbudowany w Expo / React Native.

```bash
npm install
npx expo start
```

## Build APK

Plik `CDV-Plan-<wersja>.apk` w katalogu głównym jest commitowany do repozytorium, żeby każdy mógł pobrać najnowszą wersję z GitHuba. Nie commitujemy niezwersjonowanego `CDV-Plan.apk`.

### Automatycznie (GitHub Actions)

Po pushu na `main` z zmianami w kodzie aplikacji GitHub sam buduje APK i commituje zaktualizowany `CDV-Plan-<wersja>.apk`. Po `git pull` dostajesz gotową paczkę.

### Ręcznie (lokalnie)

```bash
npm run build:apk
```

Albo krok po kroku:

```bash
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../CDV-Plan-$(node -e "console.log(require('../app.json').expo.version)")
```

Folder `android/` jest w `.gitignore` — generuje się przy buildzie i nie trafia na GitHuba. Commitowany jest tylko gotowy `CDV-Plan-<wersja>.apk`.

## Bezpieczeństwo

- Login i hasło nie są wpisane w kod aplikacji ani w skryptach testowych.
- Skrypty E2E wymagają zmiennych środowiskowych, np. `USOS_LOGIN`, `USOS_PASSWORD`, `USOS_PORTAL_URL` (szablon: `danewrazliwe.example.txt`).
- Dane logowania są zapisywane lokalnie przez `expo-secure-store`.
- Zapamiętane profile przechowują login i typ uczelni w pamięci aplikacji, a hasło w `expo-secure-store`.
- Plan semestru jest zapisywany lokalnie przez `@react-native-async-storage/async-storage`.
- Przed pracą w repozytorium należy pobrać najnowsze zmiany z GitHuba: `git pull --rebase origin main`.
- Foldery narzędzi, buildów, sesji i załączników z rozmowy są ignorowane przez `.gitignore`.

## Dokumentacja

- `MVP.md` — pełny opis funkcji aplikacji
- `lista_uczelni_obslugiwane.txt` — wszystkie obsługiwane uczelnie (generowane ze skryptu)
- `lista_usos_kompletna.txt` — uczelnie USOS z adresami portalu
- `lista_usos_z_api.txt` — uczelnie USOS z endpointami API
- `Podręcznik użytkownika Comamdziś.docx` — instrukcja dla użytkownika (generowana przez `scripts/generate-user-manual.py`)

Aktualizacja list uczelni i podręcznika:

```bash
node scripts/generate-university-lists.mjs
python3 -m venv .venv-manual && .venv-manual/bin/pip install python-docx
.venv-manual/bin/python scripts/generate-user-manual.py
```
