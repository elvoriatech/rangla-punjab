# Rangla Punjab — Menü-Diff: aktuell veröffentlicht → neue Druckkarte (2026-09)

Quelle neu: `scripts/data/rangla-menu-2026-09.json` (aus *New updated menu rangla_punjab_page13 .pdf*, 13 Seiten).  
Quelle alt: `scripts/data/rangla-menu-source.json` (der aktuell veröffentlichte Stand, 19 Kategorien / 187 Gerichte).

Zuordnung: Kategorien und Gerichte werden über den normalisierten Namen gematcht (Groß-/Kleinschreibung, Umlaute, „Groß/Gross“, Satzzeichen egal); explizite `matchNames` im neuen JSON binden Umbenennungen an ihre Vorgänger, damit Fotos und IDs erhalten bleiben.

## Zusammenfassung

| | |
|---|---|
| Kategorien alt → neu | 19 → 25 |
| Gerichte alt → neu | 187 → 212 |
| gematcht (behalten Foto + ID) | 180 |
| davon umbenannt | 28 |
| davon Preis geändert | 0 |
| davon Beschreibung geändert | 101 |
| davon Allergene geändert | 43 |
| davon Schärfegrad geändert | 25 |
| davon Ernährungs-Tags geändert | 85 |
| neu angelegt (ohne Foto) | 32 |
| entfällt (soft-delete) | 7 |
| neue Kategorien | 6 |
| entfallende Kategorien | 0 |

> Alle gematchten Gerichte hatten ein Foto und behalten es.

### Fußnoten der Druckkarte → Allergen-IDs der App

Legende von Seite 11. `src/lib/allergens.ts` kennt nur die 14 Annex-II-Allergene der VO (EU) 1169/2011, deshalb fallen mehrere Fußnoten auf dieselbe ID.

| Code | Legende (Karte) | Allergen-ID |
|---|---|---|
| `1` | Koffein | *keine — kein Annex-II-Allergen* |
| `a1` | enthält Weizen (glutenhaltig) | `gluten` |
| `a2` | enthält Gerste (glutenhaltig) | `gluten` |
| `a3` | enthält Glutamat (Zusatzstoff, kein Annex-II-Allergen) | *keine — kein Annex-II-Allergen* |
| `b` | enthält Krebstiere (-erzeugnisse) | `crustaceans` |
| `c` | enthält Ei (-erzeugnisse) | `eggs` |
| `d` | enthält Fisch (-erzeugnisse) | `fish` |
| `e` | enthält Sellerie (-erzeugnisse) | `celery` |
| `f` | enthält Soja (-erzeugnisse) | `soybeans` |
| `g1` | enthält Milch (-erzeugnisse) | `milk` |
| `g2` | enthält Laktose | `milk` |
| `h1` | enthält Mandeln | `nuts` |
| `h4` | enthält Cashewnüsse | `nuts` |
| `h5` | enthält Pistazien | `nuts` |
| `h6` | enthält Haselnüsse | `nuts` |

`traces` bleibt überall leer: die Karte kennt nur „enthält“, keine Spurenangabe.

### Neu auf der Karte

| Kategorie | Gericht | Preis |
|---|---|---|
| Thali | Vegetarisches Thali – Montag | 10,50 € |
| Thali | Vegetarisches Thali – Dienstag | 10,50 € |
| Thali | Vegetarisches Thali – Mittwoch | 10,50 € |
| Thali | Vegetarisches Thali – Donnerstag | 10,50 € |
| Thali | Vegetarisches Thali – Freitag | 10,50 € |
| Thali | Thali mit Fleisch – Montag | 12,50 € |
| Thali | Thali mit Fleisch – Dienstag | 12,50 € |
| Thali | Thali mit Fleisch – Mittwoch | 12,50 € |
| Thali | Thali mit Fleisch – Donnerstag | 12,50 € |
| Thali | Thali mit Fleisch – Freitag | 12,50 € |
| Kalte Getränke | Säfte als Schorle 0,5l | 4,50 € |
| Bier | Pils / Export / Helles 0,5l | 5,10 € |
| Bier | Hefeweizen 0,5l | 5,10 € |
| Bier | Radler-Russ 0,5l | 4,90 € |
| Aperitif | Aperol Spritz 0,25l | 7,90 € |
| Aperitif | Campari Spritz 0,25l | 7,90 € |
| Aperitif | Gin Tonic 0,25l | 8,90 € |
| Aperitif | Sekt 0,1l | 4,10 € |
| Aperitif | Wodka Lemon 0,25l | 8,90 € |
| Weißwein | Sula (Indischer Wein) 0,25l | 6,50 € |
| Weißwein | Pinot Grigio 0,25l | 6,10 € |
| Weißwein | Müller-Thurgau 0,25l | 6,10 € |
| Weißwein | Gutedel 0,25l | 6,10 € |
| Weißwein | Grauburgunder 0,25l | 6,10 € |
| Rotwein | Sula (Indischer Wein) 0,25l | 6,40 € |
| Rotwein | Spätburgunder 0,25l | 6,10 € |
| Rotwein | Merlot 0,25l | 6,10 € |
| Rotwein | Montepulciano 0,25l | 6,10 € |
| Rotwein | Chianti 0,25l | 6,10 € |
| Rotwein | Seeliebe 0,25l | 6,10 € |
| Rosé | Spätburgunder 0,25l | 6,50 € |
| Rosé | Seeliebe 0,25l | 6,10 € |

### Von der Karte genommen

| Kategorie | Gericht | bisheriger Preis |
|---|---|---|
| Kalte Getränke | Mangoschorle 0,5l | 4,50 € |
| Kalte Getränke | Orangenschorle 0,5l | 4,50 € |
| Kalte Getränke | Apfel-Schorle 0,5l | 4,50 € |
| Kalte Getränke | Johannisbeerschorle 0,5l | 4,50 € |
| Kalte Getränke | Ananasschorle 0,5l | 4,50 € |
| Kalte Getränke | Maracujaschorle 0,5l | 4,50 € |
| Kalte Getränke | Traubenschorle 0,5l | 4,50 € |

---

## Allergene: zwei Dinge, die der Inhaber prüfen sollte

**1. Die Druckkarte codiert weniger als der bisherige Datensatz — und die Karte gilt.** Der Inhaber hat die folgenden Gerichte durchgesehen und bestätigt, dass die neue Karte maßgeblich ist. `apply-menu-update.ts` läuft deshalb standardmäßig mit `--allergens=replace`: ein Gericht trägt danach genau die Allergene, die seine Fußnoten codieren, alles andere entfällt. `--allergens=union` bleibt als Schalter erhalten (ergänzt nur, löscht nie) — für eine Karte, die noch niemand Gericht für Gericht geprüft hat.

Betroffen sind 25 Gerichte:

| Kategorie | Gericht | bisher | Druckkarte = neu | entfällt |
|---|---|---|---|---|
| Warme Vorspeisen | Mix Pakora Groß (für 2–3 Personen) | milk | — | **milk** |
| Warme Vorspeisen | Jhinga Pakora | crustaceans, milk | gluten, crustaceans | **milk** |
| Warme Vorspeisen | Samosa | eggs, gluten, milk | — | **eggs, gluten, milk** |
| Warme Vorspeisen | Gemischte Tikkas | milk, sulphites | — | **milk, sulphites** |
| Warme Vorspeisen | Pani Puri | gluten, milk | — | **gluten, milk** |
| Tagessuppen | Tomatensuppe | eggs, gluten, milk, celery | — | **celery, eggs, gluten, milk** |
| Fladenbrot-Spezialitäten | Garlic Naan | gluten, milk | gluten | **milk** |
| Salate | Gemischter Salat | milk | — | **milk** |
| Salate | Chicken Salat | milk | — | **milk** |
| Vegetarische Gerichte | Sabzi Makhni | milk, nuts | — | **milk, nuts** |
| Vegetarische Gerichte | Sabzi Curry | nuts | — | **nuts** |
| Vegetarische Gerichte | Dal Tarka | milk | — | **milk** |
| Vegetarische Gerichte | Sabzi Jhalfrezi | milk | — | **milk** |
| Vegetarische Gerichte | Dal Makhni | milk | — | **milk** |
| Vegane Gerichte mit Bio-Tofu | Madrasi Tofu | sulphites, soybeans | soybeans | **sulphites** |
| Hähnchen Gerichte | Chicken Curry | milk | — | **milk** |
| Hähnchen Gerichte | Chicken Sabzi | milk | — | **milk** |
| Hähnchen Gerichte | Chicken Vindaloo | milk, sulphites, mustard | — | **milk, mustard, sulphites** |
| Hähnchen Gerichte | Chicken Korma | milk, nuts, soybeans | milk, nuts | **soybeans** |
| Hähnchen Gerichte | Chicken Karahi | milk | — | **milk** |
| Hähnchen Gerichte | Chicken Madrasi | sulphites | — | **sulphites** |
| Hähnchen Gerichte | Chicken Dopiaza | eggs, gluten, milk, celery | — | **celery, eggs, gluten, milk** |
| Tandoori Spezialitäten | Lamm Boti Tikka | nuts | — | **nuts** |
| Lamm Gerichte | Lamm Karahi | milk, nuts | — | **milk, nuts** |
| Desserts | Indisches Kulfi | gluten, milk | milk, nuts | **gluten** |

**2. Die Beschreibung nennt eine Zutat, für die die Karte keine Fußnote setzt.** Rein aus dem Text der neuen Karte gelesen — nichts davon wurde automatisch in die Daten übernommen. Das ist eine Anmerkung an die Druckerei / den Inhaber, kein Datenfehler.

| Kategorie | Nr. | Gericht | Fußnoten auf der Karte | Textstelle |
|---|---|---|---|---|
| Thali | – | Thali mit Fleisch – Freitag | g1, h1, h4 | „seelachs“ → fish |
| Warme Vorspeisen | 2 | Mix Pakora Groß (für 2–3 Personen) | — | „paneer“ → milk |
| Warme Vorspeisen | 6 | Samosa | — | „teigtaschen“ → gluten |
| Fladenbrot-Spezialitäten | 21 | Hariyali Naan | a1 | „raita“ → milk |
| Fladenbrot-Spezialitäten | 22 | Aloo Paratha | a1 | „raita“ → milk |
| Fladenbrot-Spezialitäten | 27 | Peshwari Naan | a1, g1 | „mandel“ → nuts |
| Vegetarische Gerichte | 35 | Sabzi Makhni | — | „butter“ → milk; „cashew“ → nuts |
| Vegetarische Gerichte | 36 | Sabzi Curry | — | „cashew“ → nuts |
| Vegetarische Gerichte | 43 | Malai Kofta | g1 | „cashew“ → nuts |
| Vegetarische Gerichte | 44 | Paneer Kashmiri | g1 | „cashew“ → nuts |
| Vegetarische Gerichte | 52 | Dal Makhni | — | „sahne“ → milk |
| Vegane Gerichte mit Bio-Tofu | 56 | Mango Tofu | f | „cashew“ → nuts |
| Tandoori Spezialitäten | 95 | Afghani Tandoori Chicken | h4 | „joghurt“ → milk |
| Kaffee und Tee | – | Kashmiri Chai | g1 | „pistazi“ → nuts |

---

## Unklarheiten / mutmaßliche Fehler in der Druckkarte

Keine Stelle der PDF war unleserlich. Wo der Inhaber entschieden hat, steht die Entscheidung in der letzten Spalte; alles übrige ist wortgetreu übernommen.

| Seite | Stelle | Was auffällt | Wie übernommen |
|---|---|---|---|
| 3 | Thali mit Fleisch, Donnerstag | „Chicken Churry“ und „Chicken Chana“ tragen auf der Karte vertauschte Beschreibungen (Chana = Kichererbsen) | **vom Inhaber bestätigt und getauscht**: Chicken Churry = Hähnchenfilet, saisonalem frischen Gemüse, Currysauce · Chicken Chana = Kichererbsen mit typisch indischen Gewürzen. Die gedruckten Namen bleiben |
| 3 | Thali-Kopfzeile | „11.30 – 14-30 Uhr“ (Bindestrich statt Punkt) | als „11.30 – 14.30 Uhr“ in die Kategorie-Notiz übernommen |
| 4 | Nr. 28 und Nr. 29 | beide heißen „KEEMA NAAN“, unterscheiden sich nur in der Füllung | **vom Inhaber bestätigt**: „Keema Naan (Lamm)“ / „Keema Naan (Hähnchen)“ — zwei identische Namen in einer Kategorie sind für Gast und Bestellsystem nicht unterscheidbar |
| 11 vs. 12 | Bier alkoholfrei | Seite 11 (Speisekarte): alle drei € 4,00. Seite 12 (Getränkekarte): Fürstenberg € 5,10, Radler € 4,90, Rothaus € 4,90 | **vom Inhaber bestätigt: € 4,00 (Seite 11)** = unverändert zum bisherigen Stand; Seite 12 nur für die *alkoholischen* Biere ausgewertet |
| 12 | Sekt | Mengenangabe gedruckt als „0,11l“ | als 0,1 l gelesen (Sektausschank); Preis € 4,10 unverändert übernommen |
| 5 | Nr. 42 / 44 / 46 / 47 usw. | Süß-/Schärfehinweise stehen als Kursivzusatz am Namen | Schärfe → `spice` (0–3), Süße → an die deutsche Beschreibung angehängt („– süß“, „– leicht süß“) und in alle fünf Sprachen übersetzt |
| 6 | Nr. 54 Palak Tofu / Nr. 55 Shahi Tofu | stehen unter „Vegane Gerichte“, tragen aber die Fußnote g1 (enthält Milch) | **vom Inhaber entschieden: die Fußnote gilt.** `milk` bleibt, `vegan` entfällt, `vegetarian` gesetzt. Die übrigen fünf Tofu-Gerichte bleiben vegan |
| 10 | Mango Mojito | Beschreibung identisch mit Grapefruit-Limo („Limonade aus Grapefruit, Zitronen mit Minzblätter“) | wortgetreu wie gedruckt |

---

## Änderungen je Kategorie (Reihenfolge = Druckkarte)

## Thali — **NEUE KATEGORIE**
- **NEU** Vegetarisches Thali – Montag — 10,50 €  
  _Dal Tarka – Linsengericht „Indische Art“, Currysauce · Matter Paneer – Hausgemachter frischer Rahmkäse, grüne Erbsen · Alu Chana Masala – Kartoffeln, Kichererbsen_
- **NEU** Vegetarisches Thali – Dienstag — 10,50 €  
  _Dal Tarka – Linsengericht „Indische Art“, Currysauce · Palak Paneer – Hausgemachter Rahmkäse mit Spinat · Sabzi Curry – Curry aus frischem Gemüse der Saison_
- **NEU** Vegetarisches Thali – Mittwoch — 10,50 €  
  _Dal Tarka – Linsengericht „Indische Art“, Currysauce · Paneer Butter Masala – Hausgem. Käse, Butter, indische Gewürze, süß · Alu Saag – Kartoffeln, Spinat, Zwiebeln, Ingwer, gebraten_
- **NEU** Vegetarisches Thali – Donnerstag — 10,50 €  
  _Dal Tarka – Linsengericht „Indische Art“, Currysauce · Karahi Paneer – Hausgemachter Rahmkäse, Currysauce, Paprika, Tomaten · Aloo Bengen – Gegrillte Auberginen in Currysauce_
- **NEU** Vegetarisches Thali – Freitag — 10,50 €  
  _Dal Tarka – Linsengericht „Indische Art“, Currysauce · Sabzi Curry – Curry aus frischem Gemüse der Saison · Palak Paneer – Hausgemachter Rahmkäse mit Spinat_
- **NEU** Thali mit Fleisch – Montag — 12,50 €  
  _Dal Tarka – Linsengericht „Indische Art“, Currysauce · Chicken Curry – Hähnchenfilet „Nordindische Art“ in Currysauce · Lamm Saag – Lamm in Spinat, frischer Ingwer, Knoblauch_
- **NEU** Thali mit Fleisch – Dienstag — 12,50 €  
  _Dal Tarka – Linsengericht „Indische Art“, Currysauce · Chicken Kashmeri – Gebratenes Hähnchen, getrocknete Früchte, Sauce aus Zwiebeln, Tomaten, Sahne, frischem Apfel und Granatapfel · Chicken Curry – Paprika, Tomaten, Zwiebeln in würziger Sauce_
- **NEU** Thali mit Fleisch – Mittwoch — 12,50 €  
  _Dal Tarka – Linsengericht „Indische Art“, Currysauce · Chicken Saag – Hähnchenfilet, Spinat, frischer Ingwer, Knoblauch · Lamm Curry – Lamm in Currysauce, frischer Ingwer, Knoblauch, Zwiebeln_
- **NEU** Thali mit Fleisch – Donnerstag — 12,50 €  
  _Dal Tarka – Linsengericht „Indische Art“, Currysauce · Chicken Churry – Hähnchenfilet, saisonalem frischen Gemüse, Currysauce · Chicken Chana – Kichererbsen mit typisch indischen Gewürzen_
- **NEU** Thali mit Fleisch – Freitag — 12,50 €  
  _Dal Tarka – Linsengericht „Indische Art“, Currysauce · Fisch Masala – Seelachslion in einer Zubereitung aus Zwiebeln, frischer Ingwer, Knoblauch, Tomaten, Mandeln, Cashewnüssen · Chicken Tikka Masala – Gegrilltes Hähnchenfleisch mit Zwiebeln, Tomaten, roter Currysauce, Koriander, frischer Ingwer_

## Warme Vorspeisen
- 1. **Pakoras** — Grundpreis unverändert 6,90 €; laufendes Angebot 5,90 € bleibt bestehen; Beschreibung: „gemischtes Gemüse, in Kichererbsenmehl gewendet und frittiert“ → „Gemischtes Gemüse, in Kichererbsenmehl gewendet, frittiert“; Ernährung: — → vegetarian
- 2. **Mix Pakora Groß (für 2–3 Personen)** — Beschreibung: „mit Hähnchenfleisch, Paneer, Gemüse und Sauce“ → „Hähnchen, Paneer, Gemüse, dazu Sauce“; Allergene: milk → —  ⚠ entfällt: milk
- 3. **Paneer Pakora** — Beschreibung: „hausgemachter Rahmkäse, in Kichererbsenmehl gewendet und frittiert“ → „Hausgemachter Rahmkäse in Kichererbsenmehl gewendet, frittiert“; Ernährung: — → vegetarian
- 4. **Chicken Pakora** — Beschreibung: „Hähnchenfiletstücke, in Kichererbsenmehl gewendet und frittiert“ → „Hähnchenfiletstücke in Kichererbsenmehl gewendet, frittiert“
- 5. **Jhinga Pakora** — Beschreibung: „Garnelen, in Kichererbsenmehl gewendet und frittiert“ → „Garnelen in Kichererbsenmehl gewendet, frittiert“; Allergene: crustaceans, milk → gluten, crustaceans  ⚠ entfällt: milk  ＋ neu: gluten
- 6. **Samosa** — Beschreibung: „2 gefüllte, frittierte Kartoffel-Erbsen-Teigtaschen“ → „Zwei gefüllte Kartoffel-Erbsen-Teigtaschen, frittiert“; Allergene: eggs, gluten, milk → —  ⚠ entfällt: eggs, gluten, milk; Ernährung: — → vegetarian
- 7. **Gemischte Tikkas** — Allergene: milk, sulphites → —  ⚠ entfällt: milk, sulphites
- 8. **Pommes Frites** — Ernährung: — → vegetarian
- 9. **Extra Reis** — Ernährung: — → vegetarian
- 10. **Chutneys** — Grundpreis unverändert 3,50 €; laufendes Angebot 2,50 € bleibt bestehen; Beschreibung: „Verschiedene Sauce“ → „Verschiedene Saucen“; Ernährung: — → vegetarian
- 11. **Pani Puri** — Allergene: gluten, milk → —  ⚠ entfällt: gluten, milk; Ernährung: — → vegetarian
- 12. **Chaat Papri** — Schärfe: 0 → 1; Ernährung: — → vegetarian

## Tagessuppen — *umbenannt von* „Suppen“
- 13. **Dal** — umbenannt: „Dal Suppe“ → „Dal“; Ernährung: — → vegetarian
- 14. **Sabzi** — umbenannt: „Sabzi Suppe“ → „Sabzi“; Ernährung: — → vegetarian
- 16. **Tomatensuppe** — Allergene: eggs, gluten, milk, celery → —  ⚠ entfällt: celery, eggs, gluten, milk; Ernährung: — → vegetarian

## Fladenbrot-Spezialitäten — *umbenannt von* „Indische Fladenbrot-Spezialitäten“
- 17. **Tandoori Roti** — Ernährung: — → vegetarian
- 18. **Naan** — Ernährung: — → vegetarian
- 19. **Garlic Naan** — Allergene: gluten, milk → gluten  ⚠ entfällt: milk; Ernährung: — → vegetarian
- 20. **Butter Naan** — Ernährung: — → vegetarian
- 21. **Hariyali Naan** — Beschreibung: „indisches Fladenbrot mit Koriander, Spinat und Gewürzen, dazu Raita“ → „Indisches Fladenbrot mit Koriander, Spinat und Gewürzen, dazu Raita“; Ernährung: — → vegetarian
- 22. **Aloo Paratha** — Beschreibung: „Indisches Fladenbrot gefüllt mit würzigen Kartoffeln, dazu Raita“ → „Indisches Fladenbrot mit würzigen Kartoffeln gefüllt, dazu Raita“; Schärfe: 0 → 1; Ernährung: — → vegetarian
- 23. **Paneer Naan** — Beschreibung: „indisches Fladenbrot gefüllt mit hausgemachtem Käse, dazu Raita“ → „Indisches Fladenbrot mit hausgemachtem Käse gefüllt, dazu Raita“; Ernährung: — → vegetarian
- 24. **Papadam** — Beschreibung: „Kichererbsen-Brot“ → „Kichererbsen Brot“; Ernährung: — → vegetarian
- 25. **Mix Naan** — Beschreibung: „mit Tandoori Roti, Garlic Naan, Saada Naan und Butter Naan, dazu Raita“ → „Tandoori Roti, Garlic Naan, Saada Naan, Butter Naan, dazu Raita“; Ernährung: — → vegetarian
- 26. **Cheese Naan** — Beschreibung: „Fladenbrot aus Weizenmehl mit Gouda“ → „aus Weizenmehl, mit Gouda-Käse“; Ernährung: — → vegetarian
- 27. **Peshwari Naan** — Allergene: — → gluten, milk  ＋ neu: gluten, milk; Ernährung: — → vegetarian
- 28. **Keema Naan (Lamm)** — umbenannt: „Keema Naan mit Lammfleisch“ → „Keema Naan (Lamm)“; Beschreibung: „aus Weizenmehl“ → „aus Weizenmehl, mit Lammfleisch“; Allergene: — → gluten, milk  ＋ neu: gluten, milk
- 29. **Keema Naan (Hähnchen)** — umbenannt: „Keema Naan mit Hähnchenfleisch“ → „Keema Naan (Hähnchen)“; Beschreibung: „aus Weizenmehl“ → „aus Weizenmehl, mit Hähnchenfleisch“; Allergene: — → gluten, milk  ＋ neu: gluten, milk

## Kinderteller
- 151. **Sabzi Curry** — Allergene: — → milk  ＋ neu: milk; Ernährung: — → vegetarian

## Salate
- 30. **Gemischter Salat** — Beschreibung: „Blattsalat mit Gurken, Tomaten, Mais und Granatapfelkernen“ → „Blattsalat, Gurken, Tomaten, Mais, Granatapfelkerne“; Allergene: milk → —  ⚠ entfällt: milk; Ernährung: — → vegetarian
- 31. **Chicken Salat** — Grundpreis unverändert 14,90 €; laufendes Angebot 13,90 € bleibt bestehen; Beschreibung: „gemischter Salat mit gebratenem Hähnchenfilet, Tandoori und Paprika“ → „Gemischter Salat mit gebratenem Hähnchenfilet, Tandoori, Paprika“; Allergene: milk → —  ⚠ entfällt: milk
- 32. **Paneer Salat** — Beschreibung: „gemischter Salat mit gebratenem Rahmkäse“ → „Gemischter Salat mit gebratenem Rahmkäse“; Ernährung: — → vegetarian
- 33. **Jhinga Salat** — Beschreibung: „gemischter Salat mit gebratenen Garnelen“ → „Gemischter Salat mit gebratenen Garnelen“
- 34. **Raita** — Allergene: — → milk  ＋ neu: milk; Ernährung: — → vegetarian

## Vegetarische Gerichte — *umbenannt von* „Vegetarische Spezialitäten“
- 35. **Sabzi Makhni** — umbenannt: „Sabzi Makhani“ → „Sabzi Makhni“; Allergene: milk, nuts → —  ⚠ entfällt: milk, nuts
- 36. **Sabzi Curry** — Allergene: nuts → —  ⚠ entfällt: nuts
- 37. **Matter Paneer** — Beschreibung: „hausgemachter, frischer Rahmkäse mit grünen Erbsen“ → „Hausgemachter frischer Rahmkäse, grüne Erbsen“
- 38. **Palak Paneer** — Beschreibung: „hausgemachter, frischer Rahmkäse mit Spinat“ → „Hausgemachter frischer Rahmkäse mit Spinat“
- 39. **Alu Saag** — Beschreibung: „gebratene Kartoffeln mit Spinat, Zwiebeln und Ingwer“ → „Kartoffeln und Spinat, Zwiebeln, Ingwer, gebraten“
- 41. **Karahi Paneer** — Beschreibung: „hausgemachter Rahmkäse mit Currysauce, Paprika, Tomaten und Zwiebeln“ → „Hausgemachter Rahmkäse, Currysauce, Paprika, Tomaten, Zwiebeln“
- 42. **Shahi Paneer** — umbenannt: „Shahi Paneer (leicht, süß)“ → „Shahi Paneer“; Beschreibung: „hausgemachter Rahmkäse mit Cashewnüssen und Sahnesauce“ → „Hausgemachter frischer Rahmkäse mit Cashewnüssen, in einer Sahnesauce – leicht süß“
- 43. **Malai Kofta** — Beschreibung: „Röllchen aus Kartoffeln, Rahmkäse und Cashewnüssen, in Sahnesauce“ → „Röllchen aus Kartoffeln und Rahmkäse, Cashewnüssen, in einer Sahnesauce“
- 44. **Paneer Kashmiri** — umbenannt: „Paneer Kashmiri (leicht-süß)“ → „Paneer Kashmiri“; Beschreibung: „hausgemachter Rahmkäse mit Cashewnüssen und Tomaten, in leicht süßer Sauce“ → „Hausgemachter Rahmkäse, Cashewnüssen, Tomaten, in einer leicht süßen Sauce“
- 45. **Dal Tarka** — Beschreibung: „Linsengericht mit Currysauce, nach indischer Art“ → „Linsengericht „Indische Art“, mit Currysauce“; Allergene: milk → —  ⚠ entfällt: milk
- 46. **Sabzi Jhalfrezi** — umbenannt: „Sabzi Jhalfrezi (süß-scharf)“ → „Sabzi Jhalfrezi“; Beschreibung: „saisonales, frisches Gemüse mit scharf gewürzter Sauce, Ingwer, Knoblauch und Paprika“ → „Saisonales frisches Gemüse, Ingwer, Knoblauch, Paprika, in einer scharf gewürzten Sauce – süß-scharf“; Allergene: milk → —  ⚠ entfällt: milk
- 47. **Paneer Butter Masala** — umbenannt: „Paneer Butter Masala (süß)“ → „Paneer Butter Masala“; Beschreibung: „hausgemachter Käse mit Butter, Tomaten und indischen Gewürzen“ → „Hausgemachter Käse mit Butter, Tomaten, indischen Gewürzen – süß“
- 48. **Bengen Ka Bharta** — Beschreibung: „gegrillte Auberginen mit Currysauce“ → „Gegrillte Auberginen mit Currysauce“
- 49. **Bhindi Masala** — Beschreibung: „gebratene Okraschoten mit Ingwer, Tomaten, Zwiebeln und indischen Gewürzen“ → „Okraschoten gebraten, Ingwer, Tomaten, indische Gewürze, Zwiebeln“
- 50. **Dal Palak** — Beschreibung: „Linsen mit Spinat, Zwiebeln und indischen Gewürzen“ → „Linsen mit Spinat, Zwiebeln, indisch gewürzt“
- 51. **Alu Bengen** — Beschreibung: „gegrillte Auberginen und Kartoffeln, in Currysauce“ → „Gegrillte Auberginen und Kartoffeln in Currysauce“
- 52. **Dal Makhni** — Beschreibung: „schwarze Linsen mit Sahne, Butter, Tomaten und Knoblauch“ → „Schwarze Linsen mit Sahne, Butter, Tomaten und Knoblauch“; Allergene: milk → —  ⚠ entfällt: milk

## Vegane Gerichte mit Bio-Tofu — *umbenannt von* „Vegane Spezialitäten“
- 54. **Palak Tofu** — Beschreibung: „mit Spinat und Kokosmilch“ → „Bio-Tofu mit Spinat und Kokosmilch“; Ernährung: vegan → vegetarian
- 55. **Shahi Tofu** — umbenannt: „Shahi Tofu (leicht süß)“ → „Shahi Tofu“; Beschreibung: „mit Cashewnüssen und Kokosmilch“ → „Tofu mit Cashewnüssen, in Kokosmilch – leicht süß“; Ernährung: vegan → vegetarian
- 56. **Mango Tofu** — Beschreibung: „mit Mango, Cashewnüssen, Kokosmilch und indischen Gewürzen“ → „Bio-Tofu mit Mango, Cashewnüsse, Kokosmilch, indische Gewürze“
- 57. **Karahi Tofu** — Beschreibung: „mit Currysauce, Paprika, Tomaten und Zwiebeln“ → „Bio-Tofu, in Currysauce mit Paprika, Tomaten und Zwiebeln“
- 58. **Tikka Masala Tofu** — Beschreibung: „mit Zwiebeln, Tomaten, roter Currysauce, Koriander und frischem Ingwer“ → „Bio-Tofu mit Zwiebeln, Tomaten, roter Currysauce, Koriander, frischer Ingwer“
- 59. **Chili Tofu** — Beschreibung: „in Kichererbsenmehl panierter Bio-Tofu mit Paprika, süß-saurer Tomatensauce und Sojasauce“ → „Bio-Tofu paniert in Kichererbsenmehl, Paprika, süß-sauere Tomatensauce und Sojasauce“; Schärfe: 1 → 2
- 60. **Madrasi Tofu** — umbenannt: „Tofu Madrasi“ → „Madrasi Tofu“; Beschreibung: „mit Kokosmilch, nach südindischer Art“ → „Bio-Tofu „Südindische Art“, mit Kokosmilch“; Allergene: sulphites, soybeans → soybeans  ⚠ entfällt: sulphites; Schärfe: 0 → 3

## Reis Gerichte — *umbenannt von* „Reis Spezialitäten“
- 61. **Sabzi Biryani** — umbenannt: „Sabzi Biryani (würzig)“ → „Sabzi Biryani“; Beschreibung: „garniert mit Cashewnüssen, Rosinen, gerösteten Zwiebeln, Basmatireis, Nüssen und feinen, indischen Gewürzen“ → „Garniert mit Cashewnüssen, Rosinen, gerösteten Zwiebeln. Basmatireis, Nüsse, feine indische Gewürze, dazu Raita“; Schärfe: 0 → 1; Ernährung: — → vegetarian
- 62. **Chicken Biryani** — umbenannt: „Chicken Biryani (würzig)“ → „Chicken Biryani“; Beschreibung: „garniert mit Cashewnüssen, Rosinen, gerösteten Zwiebeln, Hähnchenfilet und Basmatireis“ → „Garniert mit Cashewnüssen, Rosinen, gerösteten Zwiebeln. Hähnchenfilet, Basmatireis, dazu Raita“; Schärfe: 0 → 1
- 63. **Lamm Biryani** — umbenannt: „Lamm Biryani (würzig)“ → „Lamm Biryani“; Beschreibung: „garniert mit Cashewnüssen, Rosinen, gerösteten Zwiebeln, Lammfleisch und Basmatireis, garniert mit Cashewnüssen, Rosinen, gerösteten Zwiebeln“ → „Garniert mit Cashewnüssen, Rosinen, gerösteten Zwiebeln. Lammfleisch, Basmatireis, dazu Raita“; Schärfe: 0 → 1
- 64. **Jhinga Biryani** — umbenannt: „Jhinga Biryani (würzig)“ → „Jhinga Biryani“; Beschreibung: „garniert mit Cashewnüssen, Rosinen, gerösteten Zwiebeln, gebratenen Krabben und Basmatireis“ → „Garniert mit Cashewnüssen, Rosinen, gerösteten Zwiebeln. Krabben gebraten, Basmatireis, dazu Raita“; Schärfe: 0 → 1
- 65. **Matter Paneer Pulao** — umbenannt: „Matter Paneer Pulao (leicht süß)“ → „Matter Paneer Pulao“; Beschreibung: „mit gebratenem Käse, Erbsen, frischem Apfel, Granatapfel und Datteln“ → „Gebratener Käse, Erbsen, frischer Apfel, Granatapfel, Datteln, dazu Raita – leicht süß“; Ernährung: — → vegetarian
- 66. **Rangla Chicken Pulao** — umbenannt: „Rangla Chicken Pulao (leicht süß)“ → „Rangla Chicken Pulao“; Beschreibung: „mit Hähnchenfilet, Basmatireis, Datteln, Rosinen, Mandeln, Cashewnüssen, frischem Apfel und Granatapfelkernen“ → „Hähnchenfilet, Basmatireis, Datteln, Rosinen, Mandeln, Cashewnüsse, frischem Apfel und Granatapfelkernen, dazu Raita – leicht süß“
- 67. **Rangla Lamm Pulao** — umbenannt: „Rangla Lamm Pulao (leicht süß)“ → „Rangla Lamm Pulao“; Beschreibung: „mit Lammfleisch, Basmatireis, Datteln, Rosinen, Mandeln, Cashewnüssen, frischem Apfel und Granatapfelkernen“ → „Lamm, Basmatireis, Datteln, Rosinen, Mandeln, Cashewnüsse, frischem Apfel und Granatapfelkernen, dazu Raita – leicht süß“

## Hähnchen Gerichte — *umbenannt von* „Hähnchen Spezialitäten“
- 68. **Chicken Curry** — Beschreibung: „mit Hähnchenfilet und Currysauce, nach nordindischer Art“ → „Hähnchenfilet „Nordindische Art“ in Currysauce“; Allergene: milk → —  ⚠ entfällt: milk
- 69. **Chicken Sabzi** — Beschreibung: „mit Hähnchenfilet, saisonalem, frischem Gemüse und Currysauce“ → „Hähnchenfilet mit saisonalem frischen Gemüse, in Currysauce“; Allergene: milk → —  ⚠ entfällt: milk
- 70. **Chicken Saag** — Beschreibung: „mit Hähnchenfilet, Spinat, frischem Ingwer und Knoblauch“ → „Hähnchenfilet in Spinat, mit frischem Ingwer und Knoblauch“
- 71. **Chicken Vindaloo** — Beschreibung: „süd-indische Hähnchen-Spezialität mit Kartoffeln“ → „„Südindische Hähnchenspezialität“ mit Kartoffeln“; Allergene: milk, sulphites, mustard → —  ⚠ entfällt: milk, mustard, sulphites; Schärfe: 2 → 3
- 72. **Chicken Korma** — Beschreibung: „mit Hähnchenfleisch und einer milden Sauce aus Gewürzen, Cashewnüssen und Sahne“ → „Hähnchen in einer milden Sauce aus Gewürzen, Cashewnüssen, Sahne“; Allergene: milk, nuts, soybeans → milk, nuts  ⚠ entfällt: soybeans
- 73. **Chicken Mango** — umbenannt: „Chicken Mango (süß)“ → „Chicken Mango“; Beschreibung: „mit Hähnchenfilet und Cashewnuss-Sauce mit Mango“ → „Hähnchenfilet in Cashewnuss-Sauce, mit Mango – süß“
- 74. **Chicken Kashmiri** — umbenannt: „Chicken Kashmiri (süß)“ → „Chicken Kashmiri“; Beschreibung: „mit gebratenem Hähnchenfleisch und einer Sauce aus Zwiebeln, Tomaten, Sahne, frischem Apfel und Granatapfel“ → „Gebratenes Hähnchen in einer Sauce aus Zwiebeln, Tomaten, Sahne, frischem Apfel und Granatapfel – süß“
- 75. **Chicken Karahi** — Beschreibung: „mit Hähnchenfleischstücken, Currysauce, Paprika, Tomaten und Zwiebeln“ → „Hähnchenstücke, in Currysauce mit Paprika, Tomaten und Zwiebeln“; Allergene: milk → —  ⚠ entfällt: milk
- 76. **Chicken Madrasi** — Beschreibung: „mit Hähnchenfilet und Kokosmilch, nach süd-indischer Art“ → „Hähnchenfilet „Südindische Art“, mit Kokosmilch“; Allergene: sulphites → —  ⚠ entfällt: sulphites; Schärfe: 0 → 3
- 77. **Chicken Jhalfrezi** — Beschreibung: „mit scharf gewürztem Hähnchenfilet, frischem Ingwer, Knoblauch, Paprika und Tomaten“ → „Hähnchenfilet scharf gewürzt, mit frischem Ingwer, Knoblauch, Paprika, Tomaten“
- 78. **Chicken Dopiaza** — Beschreibung: „mit Hähnchenfilet, Currysauce und gebratenen Zwiebeln“ → „Hähnchenfilet in einer Currysauce mit gebratenen Zwiebeln“; Allergene: eggs, gluten, milk, celery → —  ⚠ entfällt: celery, eggs, gluten, milk
- 79. **Butter Chicken** — Beschreibung: „mit gegrilltem Hähnchenfleisch, Tomatensauce, Butter, Sahne, Mandeln und Cashewnüssen“ → „Gegrilltes Hähnchenfleisch mit Tomatensauce, Butter, Sahne, Mandeln und Cashewnüssen“
- 80. **Chicken Tikka Masala** — Beschreibung: „mit gegrilltem Hähnchenfleisch, Zwiebeln, Tomaten, roter Currysauce, Koriander, frischem Ingwer und indischem Masala“ → „Gegrilltes Hähnchenfleisch mit Zwiebeln, Tomaten, roter Currysauce, Koriander, frischer Ingwer, indischer Masala“
- 81. **Chili Chicken** — Beschreibung: „gebratenes Hähnchenfilet paniert in Kichererbsenmehl, mit Paprika, Sojasauce und süß-saurer Tomatensauce“ → „Gebratenes Hähnchenfilet paniert in Kichererbsenmehl, Paprika, Soja-Sauce, süß-sauere Tomatensauce“; Schärfe: 1 → 3
- 82. **Nawabi Chicken** — Beschreibung: „mit Hähnchenfleisch, Kokos-Mandelsauce und Paneer“ → „Hähnchenfleisch in einer Kokos-Mandel-Sauce und Paneer“
- 83. **Chicken Chana Masala** — Beschreibung: „mit gebratenem Hähnchenfleisch und einer Sauce aus Zwiebeln, Tomaten, Sahne“ → „Gebratenes Hähnchenfleisch in einer Soße aus Zwiebeln, Tomaten, Sahne“
- 84. **Chicken Hyderabadi** — Beschreibung: „mit Hähnchenfleisch, Cashewnuss-Sauce und Minzsauce“ → „Hähnchenfleisch mit Cashewnuss-Sauce und Minzsauce“; Schärfe: 0 → 2
- 85. **Gulabi Chicken** — umbenannt: „Gulabi Chicken (leicht süß)“ → „Gulabi Chicken“; Beschreibung: „mit Hähnchenbrust, Kardamom, Rosenblüten, Cashewnüssen, Pistazien und Mandeln“ → „Hähnchenbrust mit Kardamom, Rosenblüten, Cashewnüssen, Pistazien und Mandeln – leicht süß“
- 86. **Sookha Chicken** — Beschreibung: „mit Hähnchenbrust, Kokosnuss, Minze, würziger Sauce, Koriander und Kashmir-Masala“ → „Hähnchenbrust mit Kokosnuss, Minze, würziger Sauce, Kashmir Masala und Koriander“; Schärfe: 0 → 2

## Tandoori Spezialitäten
- 87. **Peshawari Seekh Kabab** — umbenannt: „Peshwari Seekh Kabab“ → „Peshawari Seekh Kabab“; Beschreibung: „mit Lammhackfleisch, am Spieß gegrillt und nord-pakistanisch gewürzt, dazu Chutneys“ → „Lammhackfleisch, am Spieß gegrillt, nordpakistanisch gewürzt, dazu Chutneys“; Schärfe: 0 → 1
- 88. **Hariyali Tikka** — Beschreibung: „in Minz-Joghurt mariniertes Hähnchen, am Spieß gegrillt, dazu Chutneys“ → „Hähnchen, am Spieß gegrillt, mariniert in Minz-Joghurt, dazu Chutneys“
- 89. **Chicken Tikka** — Beschreibung: „mit Hähnchenfilet und Tandoori Masala, am Spieß gegrillt, dazu Chutneys“ → „Hähnchenfilet am Spieß gegrillt, Tandoori Masala, dazu Chutney“; Schärfe: 0 → 3
- 90. **Lahori King Prawn** — Beschreibung: „gegrillte Garnelen nach Punjabi-Art, mit feinen Gewürzen und Joghurt mariniert, dazu Chutneys“ → „Gegrillte Garnelen, „Punjabi-Art“, mit feinen Gewürzen und Joghurt mariniert, dazu Chutneys“
- 91. **Garlic Chicken Tikka** — Beschreibung: „im Tandoor gegrillte Hähnchenbrust mit Knoblauch-Cashew-Marinade, dazu Chutneys“ → „Hähnchenbrust im Tandoor gegrillt, Knoblauch-Cashewnuss-Marinade, dazu Chutneys“
- 92. **Lamm Boti Tikka** — umbenannt: „Lamm Boti Tikka (süß)“ → „Lamm Boti Tikka“; Beschreibung: „mit Lammfleisch aus der Keule und indischen Gewürzen, am Spieß gegrillt“ → „Lamm aus der Keule am Spieß gegrillt, mit indischen Gewürzen“; Allergene: nuts → —  ⚠ entfällt: nuts
- 93. **Tandoori Chicken** — Beschreibung: „mit gegrillten Hähnchenschenkeln, Tandoor Masala und Joghurt-Cashewnuss-Marinade“ → „Gegrillte Hähnchenschenkel, Tandoor Masala, in einer Joghurt-Cashewnuss-Marinade“
- 94. **Paneer Tikka** — umbenannt: „Paneer Tikka (süß)“ → „Paneer Tikka“; Beschreibung: „gegrillter, hausgemachter Käse mit Gemüse-Spießen und Sauce“ → „Gegrillter hausgemachter Käse mit Gemüse-Spießen, dazu Sauce – süß“; Ernährung: — → vegetarian
- 95. **Afghani Tandoori Chicken** — umbenannt: „Afghani Tandoori Chicken (würzig scharf)“ → „Afghani Tandoori Chicken“; Beschreibung: „mit gegrillten Hähnchenschenkeln, weißem Pfeffer und Joghurt-Quark-Cashewnuss-Marinade, dazu Chutneys“ → „Gegrillte Hähnchenschenkel, weißer Pfeffer, mariniert in Joghurt-Quark-Cashewnuss-Marinade, dazu Chutneys“; Schärfe: 1 → 2
- 96. **Mix Grill-Teller** — Beschreibung: „mit Hariyali Tikka, Garlic Chicken Tikka, Peshawari Seekh und Chicken Tikka, dazu Chutneys“ → „Hariyali Tikka, Garlic Chicken Tikka, Peshawari Seekh, Chicken Tikka, dazu Chutneys“
- 97. **Jambo Grill-Teller (für 2 Personen)** — umbenannt: „Jambo Grill-Teller“ → „Jambo Grill-Teller (für 2 Personen)“; Beschreibung: „mit Hariyali Tikka, Garlic Chicken Tikka, Tandoori Chicken, Peshawari Seekh und Chicken Tikka, dazu Chutneys“ → „Hariyali Tikka, Garlic Chicken Tikka, Tandoori Chicken, Peshawari Seekh, Chicken Tikka, dazu Chutneys“
- 98. **Fisch Tikka** — Beschreibung: „Seelachslion am Spieß gegrillt, dazu Chutney“ → „Seelachslion am Spieß gegrillt, dazu Chutneys“; Schärfe: 0 → 1
- 99. **Fisch Garlic** — Beschreibung: „Seelachsloin gegrillt mit Knoblauch-Cashew-Marinade, dazu Chutneys“ → „Seelachslion gegrillt mit Knoblauch, Cashewnuss-Marinade, dazu Chutneys“

## Lamm Gerichte — *umbenannt von* „Lamm Spezialitäten“
- 100. **Lamm Curry** — Beschreibung: „Lamm in Currysauce mit frischem Ingwer, Knoblauch und Zwiebeln“ → „Lamm in Currysauce, mit frischem Ingwer, Knoblauch, Zwiebeln“
- 101. **Lamm Saag** — Beschreibung: „Lamm in Spinat mit frischem Ingwer und Knoblauch“ → „Lamm in Spinat mit frischem Ingwer, Knoblauch“
- 102. **Lamm Makhani Wala** — Beschreibung: „Lamm in würziger Mischung aus Zwiebeln, Knoblauch, Tomatencurry und Salt-Sweet-Sauce“ → „Lamm in würziger Mischung aus Zwiebeln, Knoblauch, Tomatencurry, Salt-Sweet-Sauce“
- 104. **Lamm Vindaloo** — Beschreibung: „Lamm-Spezialität nach südindischer Art mit Kartoffeln in exotischer Sauce“ → „Lammspezialität „Südindische Art“, Kartoffeln, in exotischer Sauce“; Schärfe: 2 → 3
- 105. **Lamm Madrasi** — Beschreibung: „Lamm nach südindischer Art mit Kokos“ → „Lamm „Südindische Art“, mit Kokos“; Schärfe: 0 → 2
- 106. **Lamm Korma** — Beschreibung: „Lamm in einer milden Sauce aus Gewürzen, Sahne, Mandeln, Cashewnüssen, frischem Apfel und Granatapfel“ → „Lamm in einer milden Sauce aus Gewürzen, Sahne, Mandeln und Cashewnüsse, frischem Apfel und Granatapfel“
- 107. **Lamm Dal** — Beschreibung: „Lamm mit Linsen in indischer Gewürz-Kombination“ → „Lamm mit Linsen in einer indischen Gewürz-Kombination“
- 108. **Kashmiri Kofta** — Beschreibung: „Lamm-Hackfleischbällchen mit Kashmiri Chili, Garam Masala, Anis, frischem Apfel und Granatapfel“ → „Lammhackfleischbällchen mit Kashmiri Chili, Garam Masala, Anis, frischem Apfel und Granatapfel“; Allergene: — → milk, nuts  ＋ neu: milk, nuts; Schärfe: 1 → 3
- 109. **Lamm Karahi** — Beschreibung: „Lamm mit Paprika, Tomaten, Zwiebeln und würziger Sauce“ → „Lamm mit Paprika, Tomaten, Zwiebeln in würziger Sauce“; Allergene: milk, nuts → —  ⚠ entfällt: milk, nuts
- 110. **Lamm Kashmiri** — Beschreibung: „Lamm in einer leicht süßen Sauce mit Trockenfrüchten und frischen Früchten“ → „Lamm in einer leicht süßen Sauce, mit getrockneten und frischen Früchten“
- 111. **Peshawari Seek Masala** — Beschreibung: „amm-Hackfleisch nach pakistanischer Art mit Tomaten und feiner Sauce“ → „Lammhackfleisch „Pakistanische Art“, mit Tomaten und feiner Sauce“
- 112. **Lamm Bindi Masala** — Schärfe: 0 → 3

## Gerichte mit Fisch oder Meeresfrüchten — *umbenannt von* „Fisch- und Meeresfrucht Spezialitäten“
- 113. **Fisch Curry** — Beschreibung: „Seelachslion mit Cashewnüssen, Zwiebeln und Currysauce“ → „Seelachslion mit Cashewnüssen, Zwiebeln, Currysauce“
- 114. **Fisch Masala** — Schärfe: 0 → 3
- 115. **Fisch Madrasi** — Beschreibung: „Seelachslion nach südindischer Art mit Kokosmilch und Tomatensauce“ → „Seelachslion „Südindische Art“, mit Tomatensauce und Kokosmilch“; Schärfe: 0 → 3
- 116. **Jhinga Masala** — Beschreibung: „gebratene Garnelen mit feinen, indischen Gewürzen, Ingwer, Knoblauch und Kräutern“ → „Garnelen mit feinen indischen Gewürzen gebraten, Ingwer, Knoblauch und Kräutern“; Schärfe: 0 → 2
- 118. **Jhinga Kashmiri** — umbenannt: „Jhinga Kashmiri (leicht süß)“ → „Jhinga Kashmiri“; Beschreibung: „Garnelen mit Cashewnüssen, frischem Apfel, Granatapfelkernen und Tomatensauce“ → „Garnelen, Cashewnüsse, mit frischem Apfel, Granatapfelkernen und Tomatensauce – leicht süß“
- 119. **Jhinga Dal** — Beschreibung: „Garnelen mit Linsen und indischen Gewürzen“ → „Garnelen mit Linsen, indisch gewürzt“; Schärfe: 0 → 3

## Desserts
- 120. **Indisches Halwa** — Beschreibung: „Grieß mit gemischten Trockenfrüchten“ → „Gries mit gemischten Trockenfrüchten“; Ernährung: — → vegetarian
- 121. **Indisches Vermicelles** — Ernährung: — → vegetarian
- 122. **Indisches Kulfi** — Beschreibung: „Eis mit Pistazien, Kardamom dazu Sahne“ → „Mit Pistazien, Kardamom, dazu Sahne“; Allergene: gluten, milk → milk, nuts  ⚠ entfällt: gluten  ＋ neu: nuts; Ernährung: — → vegetarian
- 123. **Gulab Jamun** — Ernährung: — → vegetarian
- 124. **Kheer** — Beschreibung: „mit Reis, Milch, Zucker, Früchten und Rosenblüten“ → „Reis, Milch, Zucker, gemischte Früchte, Rosenblüte“; Ernährung: — → vegetarian

## Hausgemachte Lassi — *umbenannt von* „Lassi“
- **Rosen Lassi 0,3l** — Allergene: — → milk  ＋ neu: milk; Ernährung: — → vegetarian
- **Rosen Lassi 0,5l** — Ernährung: — → vegetarian
- **Mango Lassi 0,3l** — Allergene: — → milk  ＋ neu: milk; Ernährung: — → vegetarian
- **Mango Lassi 0,5l** — Allergene: — → milk  ＋ neu: milk; Ernährung: — → vegetarian
- **Kokos Lassi 0,3l** — Allergene: — → milk  ＋ neu: milk; Ernährung: — → vegetarian
- **Kokos Lassi 0,5l** — Ernährung: — → vegetarian
- **Granatapfel Lassi 0,3l** — Allergene: — → milk  ＋ neu: milk; Ernährung: — → vegetarian
- **Granatapfel Lassi 0,5l** — Allergene: — → milk  ＋ neu: milk; Ernährung: — → vegetarian
- **Erdbeer Lassi 0,3l** — Allergene: — → milk  ＋ neu: milk; Ernährung: — → vegetarian
- **Erdbeer Lassi 0,5l** — Allergene: — → milk  ＋ neu: milk; Ernährung: — → vegetarian
- **Salziges Lassi 0,3l** — Allergene: — → milk  ＋ neu: milk; Ernährung: — → vegetarian
- **Salziges Lassi 0,5l** — Ernährung: — → vegetarian

## Limonade
- **Anari Scharbat** — Ernährung: — → vegetarian
- **Mango-Orangen-Limo** — Ernährung: — → vegetarian
- **Punjab' Limo** — Ernährung: — → vegetarian
- **Limetten-Limo** — Beschreibung: „Limonade aus frischen Limetten Chrushed Eis, brauner Zucker“ → „Limonade aus frischen Limetten, Chrushed Eis, brauner Zucker“; Ernährung: — → vegetarian
- **Grapefruit-Limo** — Beschreibung: „Limonade aus Grapefruit, Zitronen mit Minzblätte“ → „Limonade aus Grapefruit, Zitronen mit Minzblätter“; Ernährung: — → vegetarian
- **Mint Margarita-Limo** — Ernährung: — → vegetarian

## Alkoholfreie Cocktails
- **Punjab Sunrise** — Ernährung: — → vegetarian
- **Red Bull Lagoon** — Ernährung: — → vegetarian
- **Mango Island** — Ernährung: — → vegetarian
- **Virgin Bellini** — Ernährung: — → vegetarian
- **Mango Mojito** — Ernährung: — → vegetarian
- **Mint Margarita** — Ernährung: — → vegetarian

## Kaffee und Tee
- **Indischer Chai** — Allergene: — → milk  ＋ neu: milk; Ernährung: — → vegetarian
- **Kashmiri Chai** — Allergene: — → milk  ＋ neu: milk; Ernährung: — → vegetarian
- **Grüner Kashmir Tee** — Ernährung: — → vegetarian
- **Joshanda – Ayurvedischer Tee** — Ernährung: — → vegetarian
- **Ingwer-Minze** — umbenannt: „Ingwer-Minze Tee“ → „Ingwer-Minze“; Ernährung: — → vegetarian

## Kalte Getränke
- **Sprite 0,33l** — Ernährung: — → vegetarian
- **Sprite 0,5l** — Ernährung: — → vegetarian
- **Mezzo-Mix 0,33l** — Ernährung: — → vegetarian
- **Mezzo-Mix 0,5l** — Ernährung: — → vegetarian
- **Coca-Cola 0,33l** — Ernährung: — → vegetarian
- **Coca-Cola 0,5l** — Ernährung: — → vegetarian
- **Coca-Cola Zero 0,33l** — Ernährung: — → vegetarian
- **Coca-Cola Zero 0,5l** — Ernährung: — → vegetarian
- **Fanta 0,33l** — Ernährung: — → vegetarian
- **Fanta 0,5l** — Ernährung: — → vegetarian
- **Mineralwasser still 0,75l** — Ernährung: — → vegetarian
- **Mineralwasser Classic 0,75l** — Ernährung: — → vegetarian
- **Mangosaft 0,3l** — Ernährung: — → vegetarian
- **Orangensaft 0,3l** — Ernährung: — → vegetarian
- **Apfel-Saft 0,3l** — Ernährung: — → vegetarian
- **Johannisbeersaft 0,3l** — Ernährung: — → vegetarian
- **Ananassaft 0,3l** — Ernährung: — → vegetarian
- **Maracujasaft 0,3l** — Ernährung: — → vegetarian
- **Traubensaft 0,3l** — Ernährung: — → vegetarian
- **NEU** Säfte als Schorle 0,5l — 4,50 €
- **Eistee Pfirsich 0,4l** — Ernährung: — → vegetarian
- **ENTFÄLLT** Mangoschorle 0,5l — 4,50 € (nicht mehr auf der Druckkarte)
- **ENTFÄLLT** Orangenschorle 0,5l — 4,50 € (nicht mehr auf der Druckkarte)
- **ENTFÄLLT** Apfel-Schorle 0,5l — 4,50 € (nicht mehr auf der Druckkarte)
- **ENTFÄLLT** Johannisbeerschorle 0,5l — 4,50 € (nicht mehr auf der Druckkarte)
- **ENTFÄLLT** Ananasschorle 0,5l — 4,50 € (nicht mehr auf der Druckkarte)
- **ENTFÄLLT** Maracujaschorle 0,5l — 4,50 € (nicht mehr auf der Druckkarte)
- **ENTFÄLLT** Traubenschorle 0,5l — 4,50 € (nicht mehr auf der Druckkarte)

## Bier alkoholfrei — *umbenannt von* „Bier“
- **Radler alkoholfrei 0,5l** — Allergene: — → gluten  ＋ neu: gluten

## Bier — **NEUE KATEGORIE**
- **NEU** Pils / Export / Helles 0,5l — 5,10 €
- **NEU** Hefeweizen 0,5l — 5,10 €
- **NEU** Radler-Russ 0,5l — 4,90 €

## Aperitif — **NEUE KATEGORIE**
- **NEU** Aperol Spritz 0,25l — 7,90 €
- **NEU** Campari Spritz 0,25l — 7,90 €
- **NEU** Gin Tonic 0,25l — 8,90 €
- **NEU** Sekt 0,1l — 4,10 €
- **NEU** Wodka Lemon 0,25l — 8,90 €

## Weißwein — **NEUE KATEGORIE**
- **NEU** Sula (Indischer Wein) 0,25l — 6,50 €
- **NEU** Pinot Grigio 0,25l — 6,10 €
- **NEU** Müller-Thurgau 0,25l — 6,10 €
- **NEU** Gutedel 0,25l — 6,10 €
- **NEU** Grauburgunder 0,25l — 6,10 €

## Rotwein — **NEUE KATEGORIE**
- **NEU** Sula (Indischer Wein) 0,25l — 6,40 €
- **NEU** Spätburgunder 0,25l — 6,10 €
- **NEU** Merlot 0,25l — 6,10 €
- **NEU** Montepulciano 0,25l — 6,10 €
- **NEU** Chianti 0,25l — 6,10 €
- **NEU** Seeliebe 0,25l — 6,10 €

## Rosé — **NEUE KATEGORIE**
- **NEU** Spätburgunder 0,25l — 6,50 €
- **NEU** Seeliebe 0,25l — 6,10 €
