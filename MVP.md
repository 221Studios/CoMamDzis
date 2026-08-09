# CoMamDziś — opis aplikacji

Aktualna wersja: **0.1.29**

## Cel aplikacji

CoMamDziś to aplikacja na Androida do szybkiego sprawdzania planu zajęć z systemów uczelnianych bez ręcznego wchodzenia w przeglądarkę.

## Obsługiwane uczelnie

Aplikacja obsługuje **7 typów integracji** i **108 uczelni** łącznie (103 USOS + 5 integracji dedykowanych spoza rejestru USOS). Uczelnia jest wykrywana automatycznie po loginie.

### 1. Collegium Da Vinci (CDV)

- Logowanie do `https://wu.cdv.pl/`.
- Automatyczne wykrywanie po loginie z domeną `@edu.cdv.pl` lub `@cdv.pl`.
- Pobieranie planu, zaliczeń i spotkań ogólnouczelnianych.
- Styl aplikacji zgodny z CDV, z jasnym i ciemnym motywem.
- Skrót do Blackboard CDV w menu ustawień.

### 2. Uniwersytet WSB Merito

- Logowanie przez CAS/OAuth Merito Go (`https://meritogo.pl/`).
- Automatyczne wykrywanie po domenach Merito/WSB oraz obsługa krótkich loginów studenckich.
- Pobieranie planu zajęć i wpisów typu `STUDY`, np. egzaminów.
- Osobny jasny widok z logo i kolorami Merito.

### 3. USOS (103 uczelnie)

- Logowanie przez USOSweb (WebView) lub link iCal z planu zajęć.
- Automatyczne wykrywanie po domenie e-maila studenckiego.
- Rejestr uczelni: `src/data/usosUniversities.js`.
- Wyróżnione logo w UI: PW, UJ, UMCS.
- Pełna lista: `lista_usos_kompletna.txt`.

### 4. WSZiP (Wyższa Szkoła Zarządzania i Prawa)

- Logowanie przez Moodle (`https://mdl.wszip.poznan.pl/`) z kontem Google w przeglądarce systemowej.
- Plan pobierany z pliku PDF wybranego przez użytkownika.
- Opcjonalny plugin Moodle `local/comamdzis_plan` umożliwia przekazanie planu bez WebView Google.

### 5. Politechnika Lubelska (eHMS)

- Logowanie do eHMS (`https://ehms.pollub.pl/standard/`).
- Plan wydziałowy w formacie PDF + dopasowanie grup z eHMS.
- Wykrywanie po 6-cyfrowym loginie lub domenie `pollub.edu.pl`.

### 6. Wojskowa Akademia Techniczna (WAT)

- Dedykowana integracja z planami Plansoft na stronach wydziałów (`wat.edu.pl`).
- Wykrywanie po domenie `@wat.edu.pl`.
- Wybór wydziału i grupy zajęciowej przy pierwszym logowaniu.

### 7. WSEIT (Wyższa Szkoła Edukacji i Terapii)

- Logowanie do Wirtualnego Dziekanatu (`https://wd.wseit.pl/Logowanie`).
- Krótki login studencki (np. `zk40`), hasło zwykle data urodzenia `RRRR-MM-DD`.
- Przy kilku kierunkach — wybór profilu studiów.

## Funkcje aplikacji

### 1. Logowanie

- Użytkownik wpisuje uczelniany login/e-mail i hasło (lub link iCal / plik PDF, zależnie od uczelni).
- Aplikacja sama wybiera integrację uczelni.
- Błędne dane logowania zatrzymują użytkownika na ekranie logowania i pokazują czytelny komunikat.
- Użytkownik może zaznaczyć `Zapamiętaj profil`.
- Zapamiętane profile są widoczne na ekranie logowania jako lista kont z ikoną uczelni.
- Kliknięcie zapamiętanego profilu loguje bez ponownego wpisywania danych.
- Dane logowania są zapisywane lokalnie w bezpiecznym magazynie systemowym przez `expo-secure-store`.
- Hasło nie jest zapisane w kodzie aplikacji.
- Użytkownik może wylogować się z aplikacji i usunąć zapisane dane.

### 2. Pobieranie planu zajęć

- Przy pierwszym logowaniu aplikacja pobiera cały plan dostępny dla aktualnego semestru.
- Plan semestru jest zapisywany lokalnie w cache aplikacji osobno dla każdej uczelni.
- Po kolejnym uruchomieniu aplikacja od razu pokazuje zapisany plan, bez czekania na pobranie z internetu.
- Aplikacja automatycznie synchronizuje plan w tle po starcie, po powrocie do aplikacji oraz cyklicznie podczas używania.
- Użytkownik widzi godzinę ostatniego zapisu danych.
- Jeżeli synchronizacja wykryje dodane albo usunięte zajęcia, aplikacja pokazuje komunikat z informacją o zmianie.

### 3. Widoki planu

- Widok dzisiejszego dnia.
- Widok miesiąca.
- Nawigacja do poprzedniego i następnego dnia albo miesiąca.
- Brak przycisku ręcznego odświeżania; aplikacja robi to automatycznie.

### 4. Szczegóły zajęć

- Nazwa zajęć.
- Godzina rozpoczęcia i zakończenia.
- Forma zajęć, np. wykład, laboratoria, lektorat, zaliczenie, egzamin.
- Tryb zajęć: online albo budynek.
- Sala.
- Budynek/adres.
- Prowadzący.
- Przedmiot, grupa, opis, link online lub inne informacje, jeżeli system uczelni je zwróci.

### 5. Interfejs

- Aplikacja ma nagłówek z logotypem aktualnie wykrytej uczelni.
- W prawym górnym rogu aplikacja ma przycisk ustawień.
- W ustawieniach użytkownik może wylogować się z aplikacji.
- Dla widoku CDV użytkownik może przełączać jasny i ciemny motyw.
- Dla widoku Merito aplikacja używa dedykowanego jasnego motywu.
- Zajęcia są wyświetlane jako karty z czytelnymi polami szczegółów.
- Kolor paska karty pochodzi z typu zajęć albo stylu uczelni.
- Numer wersji aplikacji jest widoczny w menu ustawień.

## Poza zakresem

- Powiadomienia push przed zajęciami.
- Integracja z kalendarzem systemowym Android.
- Pełne natywne powiadomienia push o zmianach, gdy aplikacja jest całkowicie zamknięta.
- Publikacja w Google Play.
- Zaawansowane filtrowanie po typie zajęć.
- Automatyczna obsługa dodatkowej weryfikacji dwuetapowej, jeżeli uczelnia ją wymusi.

## Uwagi techniczne

- Aplikacja jest zbudowana w Expo / React Native.
- APK jest budowany lokalnie przez Gradle lub GitHub Actions.
- Paczka release: `CDV-Plan-<wersja>.apk` (np. `CDV-Plan-0.1.29.apk`).
- Obecna paczka APK jest podpisana debugowym kluczem, co wystarcza do ręcznej instalacji na telefonie.
- Do instalacji APK trzeba pozwolić Androidowi na instalację aplikacji z nieznanych źródeł.
- Przed każdą pracą w repozytorium obowiązuje `git pull --rebase origin main`.
- Listy uczelni generuje skrypt `node scripts/generate-university-lists.mjs`.
