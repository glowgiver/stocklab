# StockLab

Kostenlose Börsensimulation für den Unterricht (Economics S1). Schüler/innen handeln mit
10.000 $ virtuellem Geld, **begründen jede Entscheidung** und werten sie später aus.
Es geht ums Nachdenken, nicht ums Gewinnen: keine Rendite-Rangliste, keine Streaks.

Anbindung an den Lehrplan (S1): **2.1** Entscheiden mit Begründung und Opportunitätskosten ·
**2.2** rational vs. emotional (Reflexion: Verlustangst? Herde?) · **4.1/4.2** Preisbildung durch
Angebot und Nachfrage (Wand-Statistik: wie viele kaufen/verkaufen/halten) · **1.2** Modell vs. Realität.

## Sofort ausprobieren (ohne Konto, ohne Internet-Dienst)

```bash
cd stocklab
npm install
npm run dev:local
```

Baut die App und öffnet sie unter **`http://127.0.0.1:5180`** (dauert ca. 10 Sekunden). Auf der Startseite gibt es zwei Knöpfe, die direkt als Lehrkraft bzw. als Schüler „fox“ anmelden (Klasse und Runde sind schon angelegt). Zum Programmieren mit Live-Reload: `npm run dev:local:hot` (erster Start dort ~30 s). Der **lokale Demo-Modus** nutzt dieselbe Datenbank-Logik wie der echte
Betrieb (Postgres im Browser), die Daten bleiben nur in diesem Browser. Eigene Klassen kannst du ebenfalls anlegen (Lehrkraft → „Registrieren“, der Demo-Code steht auf der Seite).
Mit „Nächsten Handelstag abrechnen“ spulst du vor und siehst die Abrechnung sofort.

## Tests

```bash
npm test            # 54 Tests: Handelslogik, Abrechnung, echte Kurse, Lesetipps, Sicherheit (echtes Postgres via PGlite)
npm run test:e2e    # 4 Browser-Tests: simuliert und echte Kurse, Beitritt → Entscheidung → Abrechnung
npm run typecheck && npm run build
```

## Echter Betrieb (Supabase + GitHub Pages)

Nur das hier brauchst du von außen (alles kostenlos). Der Code ist fertig, aber **noch nie gegen ein
echtes Supabase-Projekt gelaufen** — das ist der erste Test nach dem Anlegen der Konten.

1. **Supabase-Projekt** anlegen, Region **EU (Frankfurt)**.
2. **Authentication → Providers → Email: „Confirm email“ AUS** (Schüler haben keine echte E-Mail).
3. **SQL Editor:** den Inhalt von `supabase/all_migrations.sql` einfügen und ausführen
   (neu erzeugen mit `npm run sql:bundle`, falls du Migrationen änderst).
4. **Lehrkraft-Einladungscode:** Table Editor → `app_config` → Zeile `teacher_signup_code`. Den Code
   gibst du nur Lehrkräften. Ohne ihn kann sich niemand als Lehrkraft registrieren.
5. **Lokal:** `.env` aus `.env.example` kopieren (URL + anon-Key aus Project Settings → API) und
   `npm run dev`.
6. **GitHub:** `stocklab/` als eigenes (öffentliches) Repository hochladen — Pages ist im
   Gratis-Tarif nur für öffentliche Repos verfügbar; es steht kein Geheimnis und keine
   Schülerdaten darin. Dann:
   - Settings → Pages → Source: **GitHub Actions**
   - Settings → Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - Settings → Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (nur für den täglichen Lauf)
7. Der tägliche Lauf (`settle.yml`) rechnet Mo–Fr nach Börsenschluss alle fälligen Tage ab, auch
   verpasste. GitHub schaltet geplante Läufe nach 60 Tagen ohne Repo-Aktivität ab — dann einmal
   „Run workflow“ drücken. Notfalls rechnest du in Demo-Runden von Hand ab.

**Ablauf einer Stunde:** Klasse anlegen → Klassencode an die Wand → Schüler treten mit
**Klassencode + Pseudonym + Passwort** bei → Runde anlegen und starten.

## Datenschutz

- **Pseudonyme:** Die App kennt nur ein erfundenes Pseudonym. Die Zuordnung Pseudonym → Person
  führst du auf Papier, nie in der App. Es gibt keine echten E-Mail-Adressen von Schülern (intern
  wird `pseudonym.klassencode@students.stocklab.invalid` verwendet).
- **Passwort vergessen (Schüler):** Lehrkraft-Ansicht → Klasse → „Schüler/innen & Passwörter“ →
  „Neues Passwort“ (wird einmal angezeigt, alte Sitzungen enden). Selbst ändern: oben „Passwort“.
  Lehrkraft ausgesperrt: im Supabase-SQL-Editor
  `update auth.users set encrypted_password = extensions.crypt('NEU', extensions.gen_salt('bf')) where email = 'DEINE-EMAIL';`
- Vor dem Einsatz Schulleitung/Datenschutzbeauftragte kurz informieren (Dienst mit Servern in der EU).
- Schüler sehen nur ihr eigenes Depot und ihre Entscheidungen; auch nicht die Pseudonyme der
  Mitschüler. Die Wandstatistik zeigt nur Zahlen.

## Benotung

Nur Unterricht zählt (Vorgabe der Schulleitung): Entscheidungen zu Hause sind **Übung**, keine
Bewertungsgrundlage. Bewerte, was in der Stunde entsteht (Journal-Eintrag im Unterricht,
Reflexion am Stundenende). Das Raster 40/20/20/20 ist eine **Rechenhilfe**: Du vergibst 0–4 je
Kriterium selbst; Rendite, Textlänge und Stichwörter fließen nie ein.

## Wie es gebaut ist

| Teil | Wo |
|---|---|
| Datenbank, Rechte (RLS), Abrechnung | `supabase/migrations/0001–0004` |
| Oberfläche (React, TypeScript, Tailwind, Recharts) | `src/` |
| Tägliche Abrechnung + Kursquelle | `scripts/settle.ts`, `src/lib/market.ts` |
| Tests | `tests/` (Vitest, PGlite), `e2e/` (Playwright) |

- **Schreiben nur über Funktionen:** Clients haben keinerlei Schreibrechte auf Tabellen. Jede
  Funktion (`submit_decision`, `settle_round_day`, …) läuft atomar in einer Transaktion und prüft
  selbst, wer aufruft.
- **Eine Entscheidung je Handelstag** erzwingt ein Unique-Constraint, nicht nur die Oberfläche.
- **Abrechnung:** Einsendeschluss (Standard 15:00 Berlin, je Runde einstellbar) → Ausführung zum
  Schlusskurs. Verkäufe vor Käufen. Ein Tag wird nie zweimal abgerechnet (`settlement_runs` unique).
  Fehlen Kurse, passiert **nichts** (`blocked_missing_prices`) — es wird nie ein Kurs erfunden.
- **Handelskalender:** Mo–Fr ohne NYSE-Feiertage (Tabelle `market_holidays`, bis 12/2027 gepflegt),
  zeitzonenrichtig.
- **Unveränderlich:** Kurse, Aufträge, Ausführungen, Buchungen, Tagesbewertungen und abgerechnete
  Entscheidungen lassen sich weder ändern noch löschen (Trigger).
- **Kurse:** simuliert, deterministisch, in der Oberfläche immer als „simuliert“ gekennzeichnet.
  Der ETF ist der Durchschnitt der acht Aktien (Diversifikation wird sichtbar).
- **Externe Kurse:** Adapter vorhanden, aber **aus**: erst mit `EOD_LICENSE_CONFIRMED=yes`. Vorher
  klären, ob die API Anzeige/Weitergabe an Schüler erlaubt — kostenlose Tarife oft nicht.
  Der Adapter ist nicht gegen eine echte API getestet. Umstellen einer Runde auf externe Kurse:
  `update rounds set data_mode = 'external' where id = '…'` (noch ohne Oberfläche).

## Echte Tagesschlusskurse

Eine Runde kann mit **simulierten** oder **echten Schlusskursen** laufen (Auswahl beim Anlegen).
Beide Märkte sind in der Datenbank getrennt und mischen sich nie.

**Ablauf mit echten Kursen** (ca. 2 Minuten am Abend):
1. Runde mit „Echte Schlusskurse“ anlegen → **Startkurse eintragen** (Schlusskurse des letzten Handelstags) → Runde starten.
2. Nach US-Börsenschluss (22:00 Uhr deutscher Zeit): Runde → **Kurse eintragen / abrechnen**, Kurse einfügen
   (eine Zeile je Wertpapier, z. B. `AAPL 193,09`), speichern, **Jetzt abrechnen**.
3. Fehlen Kurse, wird **nicht** abgerechnet. Verpasste Tage holst du nach (Wochenende/Feiertag werden übersprungen).
4. Ein Kurssprung > 35 % gegenüber dem Vortag wird als mögliches Tippfehler abgelehnt, bis du ihn bestätigst.
   Eingetragene Kurse lassen sich bis zur Abrechnung des Tages korrigieren, danach nicht mehr.

**Automatisch über eine Google-Tabelle (GOOGLEFINANCE):**
1. Neue, leere Google-Tabelle → Erweiterungen → Apps Script → Inhalt von `google/Code.gs` einfügen → speichern →
   Funktion `einrichten` ausführen und die Berechtigung erteilen.
2. Zum ersten Befüllen nach US-Börsenschluss (oder am Wochenende) einmal `protokollieren` ausführen.
3. In der Tabelle: Datei → Freigeben → Im Web veröffentlichen → Blatt **Protokoll** → **CSV** → Link kopieren.
4. GitHub → Settings → Secrets: `SHEET_CSV_URL` = Link. Variables: `MARKET_PROVIDER` = `google_sheet`,
   `EOD_LICENSE_CONFIRMED` = `yes`.
5. Runde mit „Echte Schlusskurse“ anlegen → in GitHub „Daily settlement“ → „Run workflow“ (holt die Startkurse) → Runde starten.

Danach läuft es werktags allein. Vergangene Tage, an denen das Google-Skript nicht lief, fehlen im Protokoll
(Google gibt Historie nicht an Skripte) — dann von Hand eintragen. Die Bedingungen von Google Finance
schränken das Speichern und Weitergeben der Daten ein: `EOD_LICENSE_CONFIRMED=yes` ist deine bewusste Entscheidung.

**Alternativ (Massive, Gratis-Konto):** Die Action holt jeden Abend die fehlenden Schlusskurse
und rechnet ab — du trägst nichts mehr ein. Einmalig einrichten:
1. Gratis-Konto bei Massive (früher Polygon.io) anlegen → API-Key kopieren.
2. GitHub → Settings → **Secrets**: `MASSIVE_API_KEY`.
3. GitHub → Settings → **Variables**: `MARKET_PROVIDER` = `massive` und `EOD_LICENSE_CONFIRMED` = `yes`.
4. Actions → „Daily settlement“ → „Run workflow“ zum Testen. Die Kurse landen als Quelle `eod_api`;
   von Hand Eingetragenes wird nie überschrieben. Das Eintragen per Hand bleibt als Notausgang.

**`EOD_LICENSE_CONFIRMED=yes` ist deine bewusste Entscheidung.** Die Gratis-Bedingungen von Massive erlauben die
Anzeige für andere nach den öffentlichen Angaben nicht (Details und Quellen: `docs/LIZENZ_ANFRAGE.md`). Das
Risiko liegt beim Konto: Der Anbieter kann es sperren. Dann einfach die Variable löschen oder `MARKET_PROVIDER`
leeren — laufende Runden bleiben erhalten, es fehlen nur neue Kurse (Notausgang: von Hand eintragen oder auf
simulierte Runden wechseln). Adresse und Pfad der Massive-Voreinstellung sind **nicht gegen die echte API getestet**.

**Lizenz:** Die Kurse selbst nachzuschlagen und der Klasse anzuzeigen kann gegen die Bedingungen des Anbieters
verstoßen. Die kostenlosen Tarife von Tiingo, Twelve Data & Co. erlauben die Weitergabe an Schüler laut
öffentlichen Angaben meist **nicht**. Vorlage für eine Anfrage und Stand der Recherche: [`docs/LIZENZ_ANFRAGE.md`](docs/LIZENZ_ANFRAGE.md).
Erst nach einer schriftlichen Zusage lässt sich der Abruf automatisieren (`MARKET_PROVIDER=http`, `EOD_LICENSE_CONFIRMED=yes`).

**Lesetipps:** Pro Runde Überschrift + Quelle + Link (nur `https`), kein kopierter Artikeltext. Die Klasse sieht sie
auf der Handelsseite und nutzt sie als Beleg im Journal.

## Noch nicht enthalten (Milestone 2)

Passiver Benchmark-Vergleich (der ETF ist da, aber noch kein automatischer Buy-and-hold-Vergleich),
Preiswirkung der Klasse auf den Kurs (nur bei simulierten Kursen sinnvoll), automatischer Kursabruf nach
geklärter Lizenz (Adapter vorhanden, nicht gegen eine echte API getestet).
