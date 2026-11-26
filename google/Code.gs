/**
 * StockLab · Google-Tabelle als Kursquelle (GOOGLEFINANCE)
 *
 * Einmal einrichten: in einer LEEREN Google-Tabelle → Erweiterungen → Apps Script → diesen Code
 * einfügen → speichern → Funktion "einrichten" ausführen → Berechtigung erteilen.
 * Legt an: Blatt "Kurse" (Live-Formeln), Blatt "Protokoll" (ein Schlusskurs je Tag und Wert)
 * und einen täglichen Zeitplan für "protokollieren" (ca. 23:15 Uhr deutscher Zeit).
 *
 * Hinweis: Die Bedingungen von Google Finance schränken das Speichern und Weitergeben der Daten ein.
 * Die Nutzung geschieht auf eigene Verantwortung. In der Tabelle stehen nur Börsenkurse.
 */
var WERTE = [
  ['AAPL', 'NASDAQ:AAPL'], ['MSFT', 'NASDAQ:MSFT'], ['AMZN', 'NASDAQ:AMZN'], ['TSLA', 'NASDAQ:TSLA'],
  ['KO', 'NYSE:KO'], ['NKE', 'NYSE:NKE'], ['DIS', 'NYSE:DIS'], ['MCD', 'NYSE:MCD'], ['URTH', 'NYSEARCA:URTH']
];
var BOERSE = 'America/New_York';

function einrichten() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetLocale('en_US');                 // Dezimalpunkt in der CSV

  var kurse = ss.getSheetByName('Kurse') || ss.insertSheet('Kurse');
  kurse.clear();
  kurse.getRange(1, 1, 1, 4).setValues([['symbol', 'google', 'price', 'tradetime']]);
  WERTE.forEach(function (w, i) {
    var z = i + 2;
    kurse.getRange(z, 1, 1, 2).setValues([w]);
    kurse.getRange(z, 3).setFormula('=GOOGLEFINANCE(B' + z + ', "price")');
    kurse.getRange(z, 4).setFormula('=GOOGLEFINANCE(B' + z + ', "tradetime")');
  });
  kurse.getRange('D:D').setNumberFormat('yyyy-mm-dd hh:mm');

  var log = ss.getSheetByName('Protokoll') || ss.insertSheet('Protokoll');
  if (log.getLastRow() === 0) {
    log.getRange('A:A').setNumberFormat('@');       // Datum als Text, damit nichts umgedeutet wird
    log.getRange('D:D').setNumberFormat('@');
    log.getRange(1, 1, 1, 4).setValues([['date', 'symbol', 'close', 'tradetime']]);
  }

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'protokollieren') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('protokollieren').timeBased().everyDays(1)
    .atHour(23).nearMinute(15).inTimezone('Europe/Berlin').create();
}

/**
 * Entscheidet, welche Kurse ins Protokoll dürfen (reine Funktion, wird getestet).
 * Nie raten: Fehlerwerte, alte oder untertägige Kurse und Doppeltes werden übersprungen.
 *   jetzt:     Date
 *   zeilen:    [[symbol, price, tradetime(Date)], …]
 *   vorhanden: { "2026-11-25|AAPL": true, … }
 *   fmtJetzt:  function(date, muster) → Text in New-York-Zeit (für „jetzt“)
 *   fmtZeit:   function(date, muster) → Text in der Zeitzone der TABELLE (für tradetime).
 *              GOOGLEFINANCE liefert tradetime als New-Yorker Uhrzeit ohne Zeitzone; die Tabelle
 *              deutet sie in ihrer eigenen Zone. Nur so formatiert steht wieder „16:00“ da.
 */
function neueZeilen(jetzt, zeilen, vorhanden, fmtJetzt, fmtZeit) {
  var heute = fmtJetzt(jetzt, 'yyyy-MM-dd');
  var stundeJetzt = Number(fmtJetzt(jetzt, 'HH'));
  var out = [];
  zeilen.forEach(function (z) {
    var symbol = z[0], preis = z[1], zeit = z[2];
    if (typeof preis !== 'number' || !(preis > 0)) return;          // #N/A o. Ä.
    if (!zeit || typeof zeit.getTime !== 'function') return;
    var tag = fmtZeit(zeit, 'yyyy-MM-dd');
    var stunde = Number(fmtZeit(zeit, 'HH'));
    if (tag > heute) return;
    if (tag === heute && stundeJetzt < 16) return;                  // Börse noch offen
    if (stunde < 12) return;                                        // letzter Handel am Vormittag → kein Schlusskurs
    if (vorhanden[tag + '|' + symbol]) return;                      // Feiertag/Doppellauf
    out.push([tag, symbol, preis, fmtZeit(zeit, 'yyyy-MM-dd HH:mm')]);
  });
  return out;
}

function protokollieren() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  SpreadsheetApp.flush();
  var zeilen = ss.getSheetByName('Kurse').getRange(2, 1, WERTE.length, 4).getValues()
    .map(function (r) { return [r[0], r[2], r[3]]; });
  var log = ss.getSheetByName('Protokoll');
  var vorhanden = {};
  log.getDataRange().getDisplayValues().slice(1).forEach(function (r) { vorhanden[r[0] + '|' + r[1]] = true; });
  var inZone = function (zone) {
    return function (d, m) { return Utilities.formatDate(d, zone, m); };
  };
  var neu = neueZeilen(new Date(), zeilen, vorhanden, inZone(BOERSE), inZone(ss.getSpreadsheetTimeZone()));
  if (neu.length) log.getRange(log.getLastRow() + 1, 1, neu.length, 4).setValues(neu);
  console.log(neu.length + ' neue Kurse protokolliert');
}
