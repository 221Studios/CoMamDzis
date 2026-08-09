# -*- coding: utf-8 -*-
import json
from pathlib import Path

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "Podręcznik użytkownika Comamdziś.docx"
with (ROOT / "app.json").open("r", encoding="utf-8") as app_config_file:
    APP_CONFIG = json.load(app_config_file)
VERSION = APP_CONFIG.get("expo", {}).get("version", "0.1.0")
UPDATED = "8 czerwca 2026"

INK = RGBColor(15, 23, 42)
BLUE = RGBColor(37, 117, 255)
CYAN = RGBColor(8, 145, 178)
MUTED = RGBColor(71, 85, 105)
BORDER = "CBD5E1"
LIGHT = "EEF6FF"


def shade_cell(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=100, start=120, bottom=100, end=120):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table, color=BORDER):
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), "6")
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), color)


def set_table_width(table, width_dxa=9360):
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.first_child_found_in("w:tblW")
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:type"), "dxa")
    tbl_w.set(qn("w:w"), str(width_dxa))
    table.autofit = False


def set_col_widths(table, widths):
    for row in table.rows:
        for idx, width in enumerate(widths):
            cell = row.cells[idx]
            cell.width = width
            set_cell_margins(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def add_bullet(doc, text):
    paragraph = doc.add_paragraph(style="List Bullet")
    paragraph.add_run(text)
    return paragraph


def add_number(doc, text):
    paragraph = doc.add_paragraph(style="List Number")
    paragraph.add_run(text)
    return paragraph


def add_note(doc, title, body):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_width(table)
    set_table_borders(table, "BFDBFE")
    cell = table.cell(0, 0)
    shade_cell(cell, LIGHT)
    set_cell_margins(cell, top=140, bottom=140, start=180, end=180)
    paragraph = cell.paragraphs[0]
    run = paragraph.add_run(title)
    run.bold = True
    run.font.color.rgb = BLUE
    run.font.size = Pt(10)
    body_paragraph = cell.add_paragraph(body)
    body_paragraph.paragraph_format.space_after = Pt(0)
    return table


def add_key_table(doc, rows):
    table = doc.add_table(rows=1, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_width(table)
    set_table_borders(table)
    headers = table.rows[0].cells
    headers[0].text = "Element"
    headers[1].text = "Znaczenie dla użytkownika"
    for cell in headers:
        shade_cell(cell, "F1F5F9")
        set_cell_margins(cell)
        for paragraph in cell.paragraphs:
            for run in paragraph.runs:
                run.bold = True
                run.font.color.rgb = INK
    for left, right in rows:
        cells = table.add_row().cells
        cells[0].text = left
        cells[1].text = right
        for cell in cells:
            set_cell_margins(cell)
    set_col_widths(table, [Inches(2.0), Inches(4.35)])
    return table


def configure_document(doc):
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    for current in doc.sections:
        current.top_margin = Inches(0.8)
        current.bottom_margin = Inches(0.75)
        current.left_margin = Inches(0.85)
        current.right_margin = Inches(0.85)
        current.header_distance = Inches(0.45)
        current.footer_distance = Inches(0.45)

    styles = doc.styles
    styles["Normal"].font.name = "Calibri"
    styles["Normal"].font.size = Pt(10.5)
    styles["Normal"].font.color.rgb = INK
    styles["Normal"].paragraph_format.space_after = Pt(6)
    styles["Normal"].paragraph_format.line_spacing = 1.12
    for name, size, color, before, after in (
        ("Heading 1", 16, BLUE, 15, 7),
        ("Heading 2", 13, CYAN, 10, 5),
        ("Heading 3", 11.5, MUTED, 8, 3),
    ):
        style = styles[name]
        style.font.name = "Calibri"
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = color
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
    styles["List Bullet"].font.name = "Calibri"
    styles["List Bullet"].font.size = Pt(10.5)
    styles["List Bullet"].paragraph_format.space_after = Pt(3)
    styles["List Number"].font.name = "Calibri"
    styles["List Number"].font.size = Pt(10.5)
    styles["List Number"].paragraph_format.space_after = Pt(3)


def add_cover(doc):
    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_before = Pt(54)
    run = paragraph.add_run("Podręcznik użytkownika")
    run.bold = True
    run.font.size = Pt(28)
    run.font.color.rgb = INK

    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run("Comamdziś")
    run.bold = True
    run.font.size = Pt(34)
    run.font.color.rgb = BLUE

    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run("Aplikacja mobilna do sprawdzania planu zajęć")
    run.font.size = Pt(13)
    run.font.color.rgb = MUTED

    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run(f"Wersja dokumentu: {VERSION} | Aktualizacja: {UPDATED}")
    run.font.size = Pt(10)
    run.font.color.rgb = MUTED

    add_note(
        doc,
        "Cel dokumentu",
        "Ten podręcznik opisuje działanie aplikacji, sposób logowania, obsługę zapisanych profili, przeglądanie planu, ustawienia oraz typowe sytuacje problemowe. Dokument należy aktualizować przy kolejnych zmianach funkcji aplikacji.",
    )
    doc.add_page_break()


def add_footer(doc):
    for section in doc.sections:
        footer = section.footer.paragraphs[0]
        footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        run = footer.add_run("Comamdziś - podręcznik użytkownika")
        run.font.size = Pt(8)
        run.font.color.rgb = MUTED


def build_manual():
    doc = Document()
    configure_document(doc)
    add_cover(doc)
    add_footer(doc)

    doc.add_heading("Szybki start", level=1)
    doc.add_paragraph(
        "Comamdziś pozwala sprawdzać plan zajęć na telefonie bez każdorazowego wchodzenia do systemu uczelni przez przeglądarkę. Aplikacja loguje użytkownika do obsługiwanej uczelni, pobiera dostępny plan i przechowuje go lokalnie, aby plan był widoczny również wtedy, gdy odświeżanie trwa dłużej."
    )
    for step in (
        "Wpisz login lub adres e-mail studenta oraz hasło.",
        "Zaznacz opcję „Zapamiętaj profil”, jeśli chcesz używać konta bez ponownego wpisywania danych.",
        "Po zalogowaniu aplikacja pokazuje zapisany plan i w tle sprawdza aktualizacje.",
        "W menu ustawień możesz przełączyć motyw, wybrać widoczność danych zajęć, otworzyć portal uczelni albo wylogować się.",
    ):
        add_number(doc, step)

    add_note(
        doc,
        "Bezpieczeństwo i wygoda",
        "Zapamiętane profile służą do szybkiego logowania na tym samym telefonie. Jeśli telefon jest współdzielony z innymi osobami, nie zapisuj profilu albo wyloguj się po użyciu aplikacji.",
    )

    doc.add_heading("Obsługiwane typy kont", level=1)
    doc.add_paragraph(
        "Aplikacja obsługuje 7 typów integracji i 72 uczelnie łącznie (67 zweryfikowanych uczelni USOS oraz 5 integracji dedykowanych spoza rejestru USOS). Uczelnia jest rozpoznawana automatycznie po loginie lub adresie e-mail."
    )
    add_key_table(
        doc,
        [
            ("Collegium Da Vinci", "Konta w domenie edu.cdv.pl lub cdv.pl. Plan z Wirtualnej Uczelni CDV. Skróty do portalu uczelni i Blackboarda."),
            ("Uniwersytet WSB Merito", "Konta Merito i WSB, w tym krótkie loginy studenckie. Plan z kalendarza Merito Go."),
            ("USOS (67 zweryfikowanych uczelni)", "E-mail studencki z domeny uczelni albo link iCal z USOSweb. Logowanie przez portal USOS lub wklejenie linku iCal. Wyróżnione logo: PW, UJ, UMCS."),
            ("WSZiP", "Konto Google uczelni w Moodle. Plan z pliku PDF pobranego z Moodle lub przekazanego przez plugin handoff."),
            ("Politechnika Lubelska", "Login i hasło eHMS oraz plan PDF wydziału. Aplikacja łączy grupy z eHMS z planem PDF."),
            ("Wojskowa Akademia Techniczna", "E-mail @wat.edu.pl. Wybór wydziału i grupy. Plan z publicznych stron Plansoft wydziałów WAT."),
            ("WSEIT", "Krótki login do wd.wseit.pl, np. zk40. Hasłem jest zwykle data urodzenia RRRR-MM-DD. Przy kilku kierunkach wybór profilu studiów."),
        ],
    )

    doc.add_heading("Logowanie i zapisane profile", level=1)
    doc.add_paragraph("Ekran logowania przyjmuje login lub adres e-mail oraz hasło. Aplikacja rozpoznaje uczelnię po formacie loginu i dobiera odpowiedni sposób pobierania planu.")
    doc.add_heading("Logowanie pierwszym razem", level=2)
    for step in (
        "Wpisz login lub adres e-mail studenta.",
        "Wpisz hasło. Ikona oka pozwala podejrzeć hasło przed wysłaniem formularza.",
        "Opcjonalnie zaznacz „Zapamiętaj profil”.",
        "Kliknij „Zaloguj”. Po poprawnym logowaniu aplikacja przechodzi do ekranu planu.",
    ):
        add_number(doc, step)

    doc.add_heading("Zapamiętane konta", level=2)
    doc.add_paragraph(
        "Zapamiętane konta są widoczne pod formularzem logowania. Wystarczy dotknąć wybranego profilu, aby aplikacja użyła zapisanych danych i otworzyła plan bez ponownego wpisywania hasła. Jeśli użytkownik ma więcej niż jedno konto, każde konto może być widoczne osobno z logo uczelni."
    )

    doc.add_heading("Przeglądanie planu", level=1)
    doc.add_paragraph("Główny ekran pokazuje zakres planu, przełącznik widoku oraz listę zajęć. Aplikacja koncentruje się na czytaniu planu, dlatego odświeżanie odbywa się automatycznie w tle.")
    add_key_table(
        doc,
        [
            ("Dziś", "Pokazuje zajęcia z wybranego dnia. Przyciski „Poprzedni” i „Następny” zmieniają dzień."),
            ("Miesiąc", "Pokazuje dni miesiąca i zajęcia w szerszym zakresie. Przyciski nawigacji przechodzą między miesiącami."),
            ("Dane zapisane", "Informacja pod przyciskami mówi, kiedy plan został ostatnio pobrany i że aplikacja sprawdza aktualizacje w tle."),
            ("Brak zajęć", "Jeżeli w danym dniu nie ma wydarzeń, aplikacja pokazuje prosty komunikat zamiast pustej listy."),
        ],
    )

    doc.add_heading("Karta zajęć", level=2)
    doc.add_paragraph("Każde zajęcia są prezentowane jako karta z godziną, nazwą, typem oraz dodatkowymi informacjami. Kolor paska z lewej strony pomaga szybko rozróżnić formę zajęć, np. wykład, ćwiczenia, laboratoria lub zaliczenie.")
    add_key_table(
        doc,
        [
            ("Godzina", "Zakres czasu rozpoczęcia i zakończenia."),
            ("Nazwa zajęć", "Przedmiot albo nazwa wydarzenia z systemu uczelni."),
            ("Forma", "Typ spotkania, np. wykład, laboratoria, ćwiczenia, lektorat, zaliczenie lub spotkanie ogólnouczelniane."),
            ("Tryb", "Informacja, czy zajęcia odbywają się w budynku czy online. Jeżeli sala wskazuje na online, aplikacja traktuje zajęcia jako online."),
            ("Sala i budynek", "Miejsce zajęć, jeżeli uczelnia udostępnia takie dane."),
            ("Prowadzący", "Imię i nazwisko prowadzącego, jeżeli informacja jest dostępna w systemie."),
            ("Link do zajęć online", "Dla zajęć online aplikacja może pokazać link, np. do Microsoft Teams, jeśli uczelnia udostępnia go w kalendarzu."),
        ],
    )

    doc.add_heading("Pobieranie i aktualizacja danych", level=1)
    doc.add_paragraph("Po pierwszym poprawnym logowaniu aplikacja pobiera dostępny plan i zapisuje go lokalnie dla danego profilu. Dzięki temu przy kolejnym uruchomieniu użytkownik od razu widzi ostatnio pobrany plan, a aplikacja w tle sprawdza, czy coś się zmieniło.")
    for item in (
        "Dane są przechowywane osobno dla każdego zapamiętanego profilu.",
        "Jeżeli pojawią się nowe zajęcia lub zajęcia zostaną odwołane, aplikacja może pokazać komunikat o zmianie.",
        "Odświeżanie nie wymaga ręcznego przycisku. Użytkownik ma przede wszystkim czytać plan, a nie obsługiwać synchronizację.",
        "Jeżeli uczelnia działa wolno lub chwilowo nie odpowiada, aplikacja nadal może pokazywać ostatnio zapisany plan.",
    ):
        add_bullet(doc, item)

    doc.add_heading("Menu ustawień", level=1)
    doc.add_paragraph("Menu ustawień jest dostępne z ekranu aplikacji. Zawiera dane profilu, przełączniki widoku oraz skróty do usług uczelni.")
    add_key_table(
        doc,
        [
            ("Twoje dane", "Sekcja danych studenta. Może zawierać informacje używane do lepszego opisania profilu."),
            ("Motyw", "Przełącza aplikację między jasnym i ciemnym wyglądem."),
            ("Adres", "Pokazuje lub ukrywa informacje o budynku/adresie na kartach zajęć."),
            ("Prowadzący", "Pokazuje lub ukrywa prowadzącego na kartach zajęć."),
            ("Informacje", "Pokazuje lub ukrywa dodatkowe informacje z systemu uczelni."),
            ("Twoja Uczelnia", "Otwiera portal uczelni w aplikacji. Dla CDV aplikacja próbuje od razu użyć zalogowanego profilu."),
            ("Blackboard", "Dostępne dla kont CDV. Otwiera Blackboard CDV i próbuje przeprowadzić logowanie przez konto CDV/Microsoft."),
            ("Wyloguj", "Kończy aktywną sesję w aplikacji. Zapamiętany profil może nadal pozostać dostępny na ekranie logowania."),
        ],
    )

    doc.add_heading("Logowanie przez USOS", level=1)
    doc.add_paragraph(
        "Dla uczelni korzystających z USOS aplikacja rozpoznaje uczelnię po domenie e-maila studenckiego i otwiera właściwy portal USOSweb."
    )
    for step in (
        "Wpisz adres e-mail studencki uczelni obsługującej USOS.",
        "Wpisz hasło do USOS albo wklej link iCal z planu zajęć (Mój USOSweb → Plan zajęć → eksportuj → Odnośnik do planu).",
        "Kliknij „Zaloguj”. Aplikacja pobierze plan z USOSweb lub z linku iCal.",
    ):
        add_number(doc, step)
    for item in (
        "Link iCal jest indywidualny dla konta — nie udostępniaj go innym osobom.",
        "Jeżeli uczelnia wymaga dodatkowej weryfikacji w przeglądarce, wykonaj ją w oknie logowania USOS.",
        "Pełna lista obsługiwanych uczelni USOS jest w pliku lista_usos_kompletna.txt w repozytorium projektu.",
    ):
        add_bullet(doc, item)

    doc.add_heading("Logowanie do WSZiP", level=1)
    doc.add_paragraph(
        "Dla studentów WSZiP plan pochodzi z pliku PDF w Moodle. Logowanie Google odbywa się w przeglądarce systemowej, nie w WebView aplikacji."
    )
    for step in (
        "Kliknij „Otwórz Moodle (Google)” i zaloguj się kontem Google uczelni.",
        "Pobierz plan zajęć jako PDF z Moodle.",
        "Wróć do aplikacji, kliknij „Dodaj PDF planu” i wskaż pobrany plik.",
        "Kliknij „Zaloguj”.",
    ):
        add_number(doc, step)

    doc.add_heading("Logowanie do Politechniki Lubelskiej (eHMS)", level=1)
    doc.add_paragraph(
        "Dla studentów Politechniki Lubelskiej aplikacja łączy dane grup z eHMS z planem PDF pobranym ze strony wydziału."
    )
    for step in (
        "Wpisz login i hasło do eHMS (te same dane co do wirtualnego dziekanatu).",
        "Pobierz plan zajęć PDF ze strony wydziału, np. wm.pollub.pl.",
        "Kliknij „Wybierz PDF planu” i wskaż pobrany plik.",
        "Kliknij „Zaloguj”.",
    ):
        add_number(doc, step)

    doc.add_heading("Logowanie do WAT", level=1)
    doc.add_paragraph(
        "Dla studentów Wojskowej Akademii Technicznej aplikacja pobiera plan z publicznych stron wydziałów WAT (Plansoft)."
    )
    for step in (
        "Wpisz adres e-mail studencki @wat.edu.pl.",
        "Wybierz wydział i grupę zajęciową z listy.",
        "Kliknij „Zaloguj”. Aplikacja pobierze plan dla wybranej grupy.",
    ):
        add_number(doc, step)

    doc.add_heading("Logowanie do WSEIT", level=1)
    doc.add_paragraph(
        "Dla studentów Wyższej Szkoły Edukacji i Terapii (WSEIT) aplikacja loguje się do Wirtualnego Dziekanatu pod adresem wd.wseit.pl. Login jest rozpoznawany automatycznie po formacie krótkiego identyfikatora studenckiego."
    )
    for step in (
        "Wpisz login do WSEIT, np. zk40.",
        "Wpisz hasło. W większości przypadków jest to data urodzenia w formacie RRRR-MM-DD.",
        "Jeżeli studiujesz na więcej niż jednym kierunku, wybierz właściwy profil studiów z listy.",
        "Kliknij „Zaloguj”. Aplikacja pobierze plan z sekcji „Plany zajęć” dziekanatu.",
    ):
        add_number(doc, step)
    for item in (
        "Profil studiów jest zapamiętywany razem z loginem, aby przy kolejnym logowaniu nie trzeba było wybierać go ponownie.",
        "Jeżeli uczelnia zablokuje dostęp z powodu zaległości finansowych, aplikacja pokaże komunikat o konieczności uregulowania opłat zamiast planu zajęć.",
        "Skrót „Twoja Uczelnia” w menu ustawień otwiera stronę logowania WSEIT w przeglądarce.",
    ):
        add_bullet(doc, item)

    doc.add_heading("Blackboard dla studentów CDV", level=1)
    doc.add_paragraph("Dla kont w domenie edu.cdv.pl aplikacja pokazuje w menu skrót „Blackboard”. Po jego kliknięciu aplikacja otwiera Blackboard CDV i rozpoczyna logowanie przez konto CDV/Microsoft.")
    for item in (
        "Aplikacja przekazuje login użytkownika do procesu SSO, aby Microsoft wiedział, którego konta użyć.",
        "Jeżeli Microsoft wymaga dodatkowej weryfikacji, komunikatu bezpieczeństwa lub zgody, użytkownik może musieć wykonać ten krok ręcznie.",
        "Jeżeli pojawi się komunikat „AADSTS90100: login parameter is empty or not valid”, zamknij okno Blackboarda i otwórz je ponownie. Od wersji 0.1.1 aplikacja próbuje automatycznie ponowić flow z poprawnym login hint.",
        "Blackboard jest zewnętrzną usługą uczelni, dlatego wygląd i dodatkowe kroki logowania mogą zmieniać się niezależnie od aplikacji Comamdziś.",
    ):
        add_bullet(doc, item)

    doc.add_heading("Rozwiązywanie problemów", level=1)
    add_key_table(
        doc,
        [
            ("Nie mogę się zalogować", "Sprawdź login, hasło i połączenie internetowe. Jeżeli dane są nieprawidłowe, aplikacja powinna pozostać na ekranie logowania i pokazać komunikat."),
            ("Plan ładuje się długo", "Po zalogowaniu aplikacja może pobierać pełny zakres planu. Przy kolejnych uruchomieniach powinna od razu pokazać zapisane dane i odświeżać plan w tle."),
            ("Brakuje sali lub prowadzącego", "Aplikacja pokazuje dane udostępnione przez system uczelni. Jeżeli system nie zwróci szczegółów, dana informacja może nie być dostępna."),
            ("Zajęcia online są opisane jako budynek", "Aplikacja rozpoznaje tryb online między innymi po sali i budynku. Jeżeli uczelnia zmieni sposób nazewnictwa, reguły mogą wymagać aktualizacji."),
            ("Blackboard pokazuje błąd Microsoft", "Zamknij okno i spróbuj ponownie. Jeśli problem wraca, sprawdź, czy konto CDV działa w przeglądarce oraz czy Microsoft nie wymaga dodatkowego potwierdzenia."),
            ("Nie widzę aktualnej wersji", "Numer wersji jest widoczny w menu ustawień obok stopki 221 studios. Przy kolejnych buildach wersja jest podbijana automatycznie."),
            ("WSEIT: brak planu po logowaniu", "Sprawdź, czy wybrano właściwy profil studiów. Jeżeli dziekanat zablokował konto z powodu zaległości, plan będzie niedostępny do czasu uregulowania należności w systemie uczelni."),
            ("USOS: nie rozpoznano uczelni", "Sprawdź, czy e-mail ma domenę studencką uczelni z listy USOS. Możesz też wkleić link iCal z planu zajęć zamiast hasła."),
            ("WSZiP: brak planu", "Upewnij się, że dodałeś plik PDF planu z Moodle. Bez PDF aplikacja nie ma skąd pobrać zajęć."),
            ("Pollub: brak zajęć", "Sprawdź, czy wybrany PDF planu odpowiada Twojemu wydziałowi i czy dane eHMS są poprawne."),
            ("WAT: zła grupa", "Wróć do logowania i wybierz inny wydział lub grupę zajęciową."),
        ],
    )

    doc.add_heading("Wersje i aktualizacje", level=1)
    doc.add_paragraph("Od wersji 0.1.1 aplikacja posiada numer wersji widoczny w menu. Przy kolejnych buildach wersja aplikacji oraz kod wersji Androida są podbijane automatycznie. Pliki APK mogą być zapisywane również z numerem wersji w nazwie, aby łatwiej rozpoznać, która paczka jest najnowsza.")

    doc.add_heading("Prywatność i dane lokalne", level=1)
    doc.add_paragraph("Aplikacja działa na danych potrzebnych do pobrania i pokazania planu. Zapamiętane profile oraz pobrany plan są przechowywane lokalnie na urządzeniu. Nie należy udostępniać pliku aplikacji ani telefonu osobom, którym nie ufa się w zakresie dostępu do danych uczelnianych.")

    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.space_before = Pt(12)
    run = paragraph.add_run("Dokument utrzymaniowy: ")
    run.bold = True
    paragraph.add_run("przy każdej większej zmianie funkcji aplikacji należy dopisać lub zaktualizować odpowiednią sekcję podręcznika.")

    props = doc.core_properties
    props.title = "Podręcznik użytkownika Comamdziś"
    props.subject = "Instrukcja obsługi aplikacji mobilnej Comamdziś"
    props.author = "221 studios"
    props.keywords = "Comamdziś, podręcznik, plan zajęć, CDV, Merito, USOS, WSZiP, Pollub, WAT, WSEIT, Blackboard"
    props.comments = "Dokument użytkownika aktualizowany wraz z aplikacją."
    doc.save(OUT)
    return OUT


if __name__ == "__main__":
    print(build_manual())
