-- StockLab Korrektur: Umlaute, die beim Kopieren beschaedigt wurden.
-- Nur ASCII; U&'\00C4' usw. sind die Umlaute als Zeichennummern. Mehrfach ausfuehrbar.
alter table class_members drop constraint if exists class_members_pseudonym_check;
alter table class_members add constraint class_members_pseudonym_check
  check (pseudonym ~ U&'^[A-Za-z0-9\00C4\00D6\00DC\00E4\00F6\00FC\00DF _-]{2,24}$');

update assets set description = 'Spreads money across companies worldwide - the passive alternative.'
 where symbol = 'URTH';

-- Kontrolle: beide Spalten muessen true zeigen
select 'M' || U&'\00FC' || 'ller' ~ U&'^[A-Za-z0-9\00C4\00D6\00DC\00E4\00F6\00FC\00DF _-]{2,24}$' as umlaut_ok,
       (select description like '% - the passive alternative.' from assets where symbol = 'URTH') as text_ok;
