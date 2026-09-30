# Himmel, Lichtobjekte und leuchtendes Gestein

## Bedienung

Im Level-Editor gibt es links **Himmel & Licht**. Sonnen und Planeten öffnen eine große **räumliche Himmelsansicht**. Auch weit herauszoomen öffnet sie. Die Halbkugel liegt um den Levelursprung; ihr Radius entspricht dem Abstand des ausgewählten Körpers. Gitternetz, Horizont, Levelgrenzen sowie Startpunkt und ATLAS machen die Position erkennbar.

- **Körper ziehen:** Himmelsrichtung und Höhe verändern, bei festem Abstand. Am Horizont wird die Bewegung begrenzt.
- **Goldener Griff am Rand:** Abstand ziehen (größenabhängige Untergrenze bis 20.000 m). Währenddessen bleibt die Kamera stehen. Körpergröße und Lichtstärke bleiben erhalten; **Ansicht einpassen** richtet den Ausschnitt anschließend auf die neue Halbkugel aus.
- **Oben / Unten:** Die dargestellte Halbkugel wechseln und den ausgewählten Körper sofort am Horizont auf diese Seite spiegeln. Richtung und Abstand bleiben erhalten; der Körper lässt sich dort direkt weiterziehen. Rückgängig/Wiederholen stellt Position und passende Halbkugel gemeinsam wieder her.
- **Alt + linke Maustaste:** Kamera drehen. **Mittlere Maustaste:** Ansicht verschieben. **Mausrad:** Zoom. Kein rechter Mausknopf erforderlich.
- **Escape während einer Geste:** Bearbeitung abbrechen. Zeigerabbruch, verlorene Zeigerbindung und Fensterwechsel stellen ebenfalls die ursprünglichen Lichtdaten wieder her.

Unsichtbare Lichtquellen erhalten auswählbare Markierungen. Die Auswahl eines Körpers zeigt automatisch seine obere oder untere Halbkugel. Jeder abgeschlossene Körper-/Abstandsdrag und jede Spiegel-Aktion bildet einen globalen Rückgängig-Schritt. Reine Kamerabewegungen verändern das Dokument nicht. Der Halbkugelwechsel verändert die Position, wenn der ausgewählte Körper auf der anderen Seite liegt. **Zur Levelansicht** stellt den vorherigen Levelausschnitt wieder her; Rückkehr aus dem Probespiel erhält Himmelsansicht, Auswahl und Kamera.

**Im Spiel sichtbar** steuert den dargestellten Körper, **Beleuchtet Szene** seinen gerichteten Lichtbeitrag. Eine unsichtbare Sonne kann deshalb weiterhin Schatten werfen. Die Kamera kann außerdem von einem sichtbaren Körper wegschauen. Bis zu vier Himmelskörper können beleuchten, einer davon ist das Hauptlicht mit Schatten. Bis zu 16 sichtbare/dekorative Körper sind möglich. Sonnen besitzen Koronen; Planeten Fels-, Ozean- und Gasvarianten sowie einen optionalen Atmosphärenrand. Planetenlicht ist ein künstlerisch einstellbares Reflexlicht, keine Simulation von Umlaufbahnen oder indirekter Lichtübertragung.

**Abstand · m** legt die Entfernung im Hintergrund fest (bis 20.000 m). **Größe bei 1.000 m · °** legt die Körpergröße unabhängig davon fest. Bei gleichem Körperradius wird ein weiter entfernter Planet kleiner sichtbar. Lichtstärke und Richtung bleiben separat einstellbar. Bestehende Himmelskörper ohne Abstandswert verwenden weiterhin 1.000 m. Die Untergrenze beträgt `max(25 m, Körperradius × 1,03 + 5 m)`: große Körper bleiben außerhalb der Kamera, können aber den Hintergrund füllen. Beim Vergrößern wird ein zu geringer Abstand zusammen mit der Größe korrigiert und gemeinsam rückgängig gemacht. Abstand wird mit dem Level gespeichert und gehört zum gemeinsamen Rückgängig-/Wiederholen-Verlauf.

**Leuchtboje**, **Warnbake**, **Bergbauscheinwerfer** und **Reaktorkern** wählen und anschließend im Level platzieren. Die Objekte lassen sich im Flugraum ziehen oder über die Eigenschaften positionieren. Höhe bezieht sich auf Gelände beziehungsweise Flugebene. Farbe, Leistung, Reichweite und Dauerlicht/Pulsieren/Flackern sind einstellbar; Scheinwerfer besitzen zusätzliche Winkel. Die ausgewählte Lampe zeigt Reichweite und Lichtkegel. Lichtobjekte haben keine Kollision und keine Missionsfunktion. Sie funktionieren auch auf Aster.

**Leuchtendes Gestein** liegt bei der Asteroidenauswahl rechts. **Form bearbeiten → Oberfläche malen → Leuchten** bemalt einen unabhängigen Kanal; Strg entfernt ihn. Farbe, Intensität und **Spalten betonen** verändern die Darstellung ohne neue Kollision oder Formberechnung. Ein Pinselstrich bleibt ein Undo-Schritt.

Der optionale **innere Leuchtbereich** ist ein lokales Ellipsoid mit Zentrum, drei Radien und weichem Rand. Nur wirkliche Felsoberflächen innerhalb dieses Bereichs leuchten. Neue Öffnungen können den Bereich freilegen; geschlossene Felsen werden nicht durchsichtig. Das Gesteinsrelief bleibt im Leuchten sichtbar.

Unter **Erzleuchten** erhält jede gemalte Erzschicht eine eigene Farbe und Intensität. Das Leuchten der Mineralstücke und der dünnen Oberflächenschicht nimmt beim Abbau pro getroffener Probe ab. Leuchtendes Wirtsgestein bleibt davon unabhängig.

## Daten und Renderer

- Level-/Sculpt-/Vorlagenformat 2 bleibt lesbar. Optionale `LightingDefinition` und `RockGlow` besitzen eine eigene Version 1; alte Daten erhalten neutrale Standardwerte. Es gibt keinen Datenbank-Upgrade und keine Löschung. Die bisherige Theme-Beleuchtung wird als unsichtbares Haupt- und Streiflicht übernommen.
- Lichtobjekte liegen vollständig im Level. Asteroidenvorlagen enthalten Masken, Kernparameter und Erzleuchten, aber keine Himmelskörper oder frei platzierten Lampen. Beim Einfügen bleiben Kopien unabhängig.
- Der Himmelseditor hat eine eigene Perspektivkamera und Szene, nutzt aber dieselben Körpermaterialien und Größenberechnungen wie das Spiel. Vorschauen verändern bestehende Körper und Uniforms; Gelände, Miniatur und Kollisionsdaten werden beim Ziehen nicht neu aufgebaut. Die Miniatur aktualisiert sich nur bei Änderungen am Level-Layout.
- Ein eigener Hintergrunddurchlauf enthält Nebelstruktur, Sterne und Himmelskörper; anschließend folgt die Spielwelt mit neuem Tiefenpuffer. Dadurch verdecken Felsen die Himmelskörper und das bisherige Sternenbild übermalt sie nicht.
- Materialleuchten nutzt den bestehenden HDR-/Bloom-Pfad. High besitzt vier lokale Punktlichtplätze und zwei Scheinwerferplätze, Standard zwei und einen. Erz- und Gesteinslicht teilen sich die Punktlichtplätze mit Lampen. Die Auswahl berücksichtigt Stärke, Entfernung zum Kamera-Fokus und Hysterese; Wechsel blenden aus und ein. Eine Lampe bleibt als leuchtendes Objekt auch außerhalb des aktiven Budgets sichtbar.
- High erlaubt einem Scheinwerfer einen lokalen Schatten. Standard hat keine lokalen Schatten. Farblicher Lichtübertrag ist eine begrenzte Annäherung, keine vollständige globale Beleuchtung. Ein verschlossener Kern erzeugt keine Lichtquelle; nur freigelegte leuchtende Oberflächen liefern Näherungslichter.
- Reine Licht-, Erzleucht- und Kernparameter ändern existierende Materialien/Lichter, einschließlich Undo/Redo. Die Landschaft und ihre Kollisionsgeometrie bleiben dabei erhalten. Die Leuchtmaske wird im bestehenden Worker als separater skalarer Kanal berechnet.

## Prüfung

- `src/lighting.test.ts`: alte Themes, Datenlimits und Referenzen, JSON, unabhängige Erz-/Leveldaten, neutrale Geometrie beim Leuchtmalen, Entfernen, geschlossene und geöffnete Kerne.
- `/tests/sky-editor.html`: direkte Körper-/Abstandsdrags, feste Kamera während radialer Bearbeitung, Horizontbegrenzung, explizite Spiegelung, Abbrechen und globales Undo/Redo, getrennte Kameras, Probespielrückkehr, IndexedDB/JSON sowie GPU-Geometrieentwicklung. `src/sky-editor.test.ts` prüft zusätzlich die räumlichen Abfragen und gemeinsame Körpergröße.
- `/tests/lighting.html`: Live-Renderer und Uniforms, Undo/Redo, Himmelsansicht, Worker-Malerei, lokaler Leuchtabbau, IndexedDB/JSON, Vorlagenkopien, Aster, High/Standard, 36 lokale Lichtobjekte im Probespiel und wiederholte Szenenwechsel.
- Regression: 113 Unit-Tests, 32 bestehende Editorprüfungen und 124 Maus-/Erzprüfungen bestanden. Der Lichttest prüft zusätzlich den Erhalt frischer Materialänderungen beim Qualitätswechsel und die sofortige Anpassung der Planetengröße.
- Browserprotokoll und Ansichten: `screenshots/lighting/`. Die 1080p-Messung im Codex-Browser liegt bei etwa 57 FPS; die bisherige Browser-Baseline liegt ebenfalls etwa bei 57 FPS. 60 FPS sind daher auf diesem Ausgabegerät nicht bestätigt. Detaillierte Werte einschließlich p95, Draw Calls und Geometrie-/Texturanzahl stehen im Protokoll.

### Räumliche Halbkugel · Prüfung vom 30.09.2026

Produktionsbuild und 123 Unit-Tests bestanden. Die neue Himmelsprüfung besteht aus 43 erfolgreichen Browserprüfungen; die bestehende Lichtregression aus 35. Zusätzlich wurden Körper und Abstandsgriff mit echten Mausgesten bedient. Protokolle und Ansicht liegen in `screenshots/sky-editor/`.

Bei 1920 × 1080 misst die Himmelsansicht 17,6 ms mediane Framezeit und 18,1 ms p95 (etwa 57 FPS im Testbrowser), mit 13 Draw Calls. Die GPU-Geometrieanzahl bleibt über fünf Ansichtswechsel bei 82. Damit ist kein Wachstum in diesem Ablauf erkennbar; 60 FPS sind auf diesem Testbrowser nicht bestätigt. High und Standard der bestehenden beleuchteten Szene sowie Probespielwechsel bestehen ebenfalls; deren Messwerte stehen im Lichtregressionsprotokoll.

Planetengelände erhält bereits Himmels- und Lichtobjekte. Leuchtmalerei auf Planetengelände gehört zum späteren Planetensculpting.

## Spielwinkel, Sonnen und Planetenringe · 30.09.2026

**Spielwinkel** richtet die räumliche Übersicht wie die reguläre Spielkamera aus. **Spielvorschau** zeigt den Startpunkt mit orthografischer Spielkamera, dem tatsächlichen Himmelsdurchlauf, Felsen, Bloom und den übrigen Qualitätsoptionen. Das Bild behält das Seitenverhältnis des Spielfensters und erhält schwarze Ränder, soweit die Editorfläche es erfordert. Die Vorschau animiert die Darstellung, simuliert aber keine Expedition und zeigt keine Ankunftssequenz. Zurück oder Escape stellt die unveränderte Übersichtskamera wieder her.

Die Sonne besitzt eine bewegte Plasmaoberfläche, unregelmäßige Flammen, gebogene Protuberanzen und einen weichen Halo. **Flammenausdehnung**, **Koronastärke** und **Plasmabewegung** sind von der globalen Lichtstärke unabhängig. **Korona** schaltet den Rand vollständig ab. Im Spiel verwendet die Animation die Expeditionszeit und friert mit ihr bei Pause ein. High zeigt vier, Standard zwei Flammenbögen.

Bei Planeten aktiviert **Ring aktivieren** den konzentrischen Ring. Innen-/Außenradius werden in Planetenradien angegeben; Standardwerte sind 1,3 und 2,8. Farbe, Deckkraft und Staub-/Eisdichte sind getrennt einstellbar. **Ring interaktiv ausrichten** öffnet drei farbige Drehgriffe um X, Y und Z; die Winkel lassen sich auch rechts numerisch eingeben. Derselbe Button wird zu **Ringausrichtung beenden**. Auch der Button in der Himmelsleiste und Escape verlassen den Modus. Die Auswahl eines anderen Körpers und die Rückkehr zur Levelansicht beenden ihn ebenfalls. Der Ring bleibt immer im Planetenzentrum. Eine abgeschlossene Drehgeste ist ein Rückgängig-Schritt; Escape, Zeigerabbruch, verlorene Bindung oder Fensterwechsel verwerfen eine laufende Geste.

Die entfernte Ringfläche zeigt körnige Fels-/Eisansammlungen, schwache Bänder, eine Lücke und den Schatten des Planeten. In der Nähe geht sie in echte, geschlossene Fels- und Eisbrocken über: unterschiedliche Größen und Achsen, angeschlagene Flächen, Beleuchtung und Eisglanz. Sie schreiben Tiefe und verdecken sich räumlich; die Schattenzone des Planeten bleibt erhalten. Ringfläche und Brocken verwenden dieselbe räumliche Ringebene. Abstand, Größe und Neigung können den Ring in den Flugraum führen. Ein ortsfester, toroidal nachgeführter Ausschnitt hält sichtbare Brocken an ihrem Ort und verschiebt nur außerhalb des Ausblendrands liegende Instanzen. Entfernte Ausschnitte werden vollständig ausgelassen. Spiel und Himmelsübersicht verwenden denselben Renderer. Alle Ringe teilen sich ein Budget von 2.000 instanzierten Brocken in High beziehungsweise 700 in Standard, mit 20 Dreiecken je Brocken und einem Draw Call je nahem Ring. Die Ringdarstellung besitzt keine Kollision und keine Rohstofffunktion.

Optionale `SkyBody.corona` und `SkyBody.ring` liegen vollständig in Level-JSON und IndexedDB. Daten ohne diese Felder bleiben lesbar: Korona nutzt Standardwerte, Ringe sind ausgeschaltet. Duplizieren kopiert verschachtelte Einstellungen unabhängig. Es gibt keine Migration und keine Löschung vorhandener Level.

### Aktuelle Prüfung

- 130 Unit-Tests; sieben zusätzliche Prüfungen behandeln sichere Nähe, Importvalidierung, Ringebenen, globale Partikelbudgets, Zeit/Pause, JSON und Kameraausrichtung.
- 35 Browserprüfungen unter `/tests/celestial.html`: Nähe, Größenkorrektur, Drehgriffe, Abbruch/Undo/Redo, Kopien, Vorschau ohne Zustandsänderung, Kameraerhalt, Speicherung, Qualitätswechsel, vollständiger Probespielwechsel und Aster.
- 43 bestehende räumliche Himmelsprüfungen und 35 Lichtregressionen bestanden. Die Ringdrehung wurde zusätzlich mit echten Mausgesten einschließlich einer seitlich sichtbaren Achse und Rückgängig geprüft. Protokolle und Ansichten liegen unter `screenshots/celestial/`.
- Bei 1920 × 1080 in der Testszene mit drei großen Körpern, Sonne und Ring: High 16,7 ms Median / 17,3 ms p95, 204 Draw Calls und 2.000 Ringpartikel; Standard 16,7 ms / 17,1 ms, 112 Draw Calls und 700 Partikel. Das entspricht rund 60 FPS in dieser Szene, nicht einer Garantie für beliebig dichte Entwürfe. Die GPU-Geometrieanzahl bleibt über fünf Übersicht-/Vorschauwechsel bei 109.

Sonne, Ring und nahe Fels-/Eisbrocken benötigen keine zusätzlichen Texturdownloads; ihre Darstellung wird im gemeinsamen Shader berechnet.

Die entfernte Ringfläche verwendet weiterhin die perspektivische Himmelskamera; die Flugphysik und reguläre Spielkamera bleiben orthografisch. Nahe Brocken vermitteln die Ringebene im Flugraum.


## Ringnähe und Editorbedienung · 30.09.2026

**Bearbeiten** steht in der normalen Levelauswahl unter jeder Levelkarte. Eingebaute Level öffnen als eigene Kopie, gespeicherte Entwürfe unter ihrer bisherigen ID. Auch ein ungültiger Entwurf lässt sich dort öffnen und korrigieren.

- 131 Unit-Tests und Produktionsbuild bestanden.
- 37 Himmelskörper-, 45 räumliche Himmels- und sieben Levelmenüprüfungen bestanden; 35 bestehende Lichtregressionen bestanden ebenfalls. Echte Mausklicks bestätigen den wechselnden Ring-Button; obere und untere gespiegelte Körper wurden ohne vorheriges Verschieben zum Horizont gezogen.
- 1920 × 1080, Ring-Testszene: High 17,6 ms Median / 18,4 ms p95, 204 Draw Calls; Standard 17,8 ms / 18,2 ms, 112 Draw Calls. Das entspricht etwa 57 bzw. 56 FPS in diesem Testbrowser; 60 FPS sind in dieser Messung nicht erreicht. Instanzenbudgets: 2.000 / 700. Geometrieanzahl über fünf Vorschauwechsel: konstant 102.
- Protokolle und Bilder: `screenshots/ring-refinement/`.

## Planetenatmosphäre und Editorstart · 30.09.2026

Unter **Planetenatmosphäre** steuern **Atmosphärenhöhe · % des Radius** (0,5–50 %), **Atmosphärenstärke** (0–5) und **Atmosphärenfarbe** eine räumliche, weich auslaufende Hülle. Planetengröße, Entfernung und globale Beleuchtung bleiben unabhängig davon. **Atmosphärenrand** schaltet die gesamte Hülle ein oder aus. Jede Änderung gehört zum globalen Rückgängig-/Wiederholen-Verlauf.

Der gemeinsame Shader integriert eine abnehmende Dichte entlang des Blickstrahls und berücksichtigt die Planetenoberfläche, beleuchtete Seite und Abschattung. Farbige Rayleigh-Streuung und ein wärmerer Streiflichtanteil ergeben einen helleren Tagrand und eine schwächere Nachtseite. High verwendet zwölf, Standard acht Abtastungen. Die Sonnenkorona bleibt unverändert. Der Effekt benötigt keine zusätzlichen Texturen und verwendet dieselbe Geometrie bei Parameter- und Qualitätswechseln.

Das optionale Feld `SkyBody.air` enthält `extent`, `strength` und `color`. Alte Level ohne dieses Feld erhalten 8 % Höhe, Stärke 1,2 und einen blauen Streuton. Bestehende Level und Vorlagen bleiben lesbar; eine Datenbankmigration ist nicht erforderlich. Kopieren, IndexedDB und JSON erhalten die Einstellungen unabhängig.

Die Levelauswahl berechnet gespeicherte Asteroidenwelten erst beim Öffnen oder Starten des gewählten Levels. Beim Editorstart sind das Hauptmenü und der Pausehintergrund ausdrücklich verborgen. Ein fehlgeschlagener Erstaufbau oder Renderfehler führt zur bedienbaren Levelauswahl mit Fehlermeldung zurück.

Prüfprotokolle und Ansicht: `screenshots/atmosphere-editor/`. 134 Unit-Tests und Produktionsbuild bestanden. Der Atmosphärentest enthält 15 Browserprüfungen; der Levelmenütest enthält zwölf einschließlich eines absichtlich beschädigten Entwurfs und des anschließenden gültigen Starts. Der Produktionsbuild wurde separat geöffnet und geprüft.

Die bestehenden 37 Himmelskörperprüfungen bestehen ebenfalls: Sonnenkorona, Ringausrichtung, Abbrechen, globale Rückgängig-Schritte, unabhängige Kopien, Speicherung, Vorschau und Aster. Alle geprüften Shader kompilieren ohne WebGL-Fehler.

Bei bestätigten 1920 × 1080 in der Atmosphärenszene: High 17,7 ms Median / 18,6 ms p95 und 227 Draw Calls; Standard 17,5 ms / 18,3 ms und 117 Draw Calls. Das entspricht rund 57 FPS im Testbrowser; die 60-FPS-Zielmarke ist hier nicht bestätigt. Die Geometrieanzahl bleibt über fünf Übersicht-/Vorschauwechsel bei 93.

Der konkrete Hänger in Vivaldi auf der geschützten Website wurde nicht reproduziert. Die direkte Remoteprüfung wurde von der automatischen Freigabeprüfung beim Wechsel zur separaten Cloudflare-Access-Anmeldedomain abgelehnt. Diese Änderungen sind lokal implementiert und geprüft, noch nicht auf der Website veröffentlicht.
