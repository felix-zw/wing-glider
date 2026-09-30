# Level Workshop und Echtzeit-Sculpting

Three.js bleibt die gemeinsame Darstellung für Spiel und Editor. Der Desktop-Editor öffnet sich über **Level-Editor** im Hauptmenü. **Bearbeiten** unter einer Karte der normalen Levelauswahl öffnet das jeweilige Level: eingebaute Level als eigene Kopie, gespeicherte Entwürfe direkt unter ihrer bisherigen ID. Eigene Level speichern ihre Formen und Erze selbst; eine Vorlagenbibliothek ist nicht erforderlich. Aster, Fahrzeugsteuerung, Audio und mobile Spielsteuerung bleiben erhalten. Planetensculpting gehört nicht zu diesem Ausbau.

## Bedienung

Neu: **Himmel & Licht**, lokale Lampen, Leuchtpinsel und leuchtende Asteroidenkerne. Bedienung, Daten und Lichtbudgets stehen in [LIGHTING-WORKSHOP.md](LIGHTING-WORKSHOP.md).

**Asteroiden-Generator** erzeugt neue lokale Formen oder erneuert Form, Erze, Oberflächenleuchten und Inneres einer vorhandenen Auswahl getrennt. Alle Bearbeitungen verwenden den gemeinsamen Verlauf mit Rückgängig und Wiederholen. Bedienung und Prüfungen: [ASTEROID-GENERATOR.md](ASTEROID-GENERATOR.md).

1. Einen Planeten oder Gürtel als eigenen Entwurf öffnen. Für Asteroiden gibt es **Bruchplatte**, **Angeschnittener Körper**, **Quaderähnlicher Brocken**, **Länglicher Splitter** und **Felsmasse**. Jeder Paletteintrag erzeugt eine unabhängige lokale Form.
2. Objekt auswählen, verschieben, drehen, skalieren oder duplizieren. Die Objektliste zeigt den Formnamen. Weltansicht und Formkamera bleiben getrennt.
3. **Form bearbeiten**: links pinseln, mit **Alt + Ziehen**, der **mittleren** oder **rechten Maustaste** die Kamera drehen, mit dem Mausrad zoomen. Dieselben Kameragesten verschieben in der Levelansicht den Ausschnitt. Der Editor unterdrückt Kontextmenü und Maus-Standardaktionen auf seiner Zeichenfläche; für Browser oder Erweiterungen, die Rechtsklick-Gesten vor der Webseite verarbeiten, stehen Alt + Ziehen und die mittlere Maustaste zur Verfügung. **Auftragen** und **Abtragen** wirken fortlaufend bei gedrücktem Pinsel, auch ohne Mausbewegung. Daneben gibt es **Ziehen**, **Glätten**, **Abflachen** und **Oberfläche malen**. Radius, Stärke und weicher Rand sind einstellbar. Strg kehrt Auftragen/Abtragen um; Umschalt aktiviert Glätten. Escape oder ein abgebrochener Zeigerkontakt verwirft den laufenden Strich. Ein abgeschlossener Strich ist genau ein Rückgängig-Schritt.
4. **Erz aufsprühen**: Ferrit, Kupfer oder Kristall wählen und eine maximale Schichtdicke einstellen. Auch Innenflächen können bemalt werden. Längeres Sprühen erhöht die Dicke. Die Menge ergibt sich aus bemalter Fläche × Dicke × Materialdichte. Skalieren verändert das physische Volumen und damit die Menge.
5. **Als Vorlage speichern** ist optional. Das Einfügen kopiert Form, Materialmalerei und Erzschichten mit neuen IDs. Die Vorlage enthält keine Weltposition oder Missionsziele. Änderungen oder Löschen der Vorlage verändern keine Platzierung.
6. Nach der abschließenden Formberechnung startet **Probespielen** eine eigene Expedition. Beim Zurückkehren bleiben Entwurf, Auswahl und Bearbeitungsverlauf erhalten. Abgebautes Erz verändert den Entwurf nicht.

Entwürfe werden in IndexedDB automatisch gespeichert und als vollständige JSON-Pakete exportiert. Import prüft Format, Datenlimits, Asset-Verweise und Mengen. Der Import benötigt keine Vorlagensammlung. Fehlerhafte Entwürfe bleiben speicherbar; ein blockierter Startpunkt, eine blockierte ATLAS-Zone oder eine Erzschicht ohne tragende Fläche verhindern den Spielstart. **Ungültige Stellen entfernen** entfernt nur nicht mehr unterstützte Teile einer Erzschicht. Gültige Teile bleiben erhalten.

## Daten und Revisionsgrenzen

- `LevelDocument`, `LevelPackage` und `SculptDefinition` verwenden Version **2**. Die Vorlagen sind ebenfalls Version 2. `OreLayer` ist die neue Schichtstruktur mit Version 1, kein altes Asteroidenformat.
- Eine Form enthält Grundform, Seed, zeitgewichtete Pinseloperationen und Materialparameter. Der Worker hält Dichte und vier Materialmasken als räumliche Felder. Radius/Falloff/Operationen gehören zum allgemeinen Pinselmodell und können später auch Planetengelände steuern.
- Das Formvolumen umfasst 72 lokale Meter. High verwendet ein 49³-Feld, Standard ein 31³-Feld; bei Überschreitung des Dreiecksbudgets wird das finale Mesh mit niedrigerer Auflösung erzeugt. Die Obergrenzen sind 40.000 bzw. 12.000 Dreiecke. Sehr kleine Details unterhalb der Rasterweite sind Materialdetail.
- Während eines Strichs laufen Änderungen geordnet in einem Worker. Nur betroffene Abschnitte werden neu trianguliert und am ausgewählten Objekt ausgetauscht. Andere Weltobjekte und Editorfelder werden dabei nicht neu aufgebaut. Epochen verwerfen Antworten abgebrochener oder ersetzter Sitzungen.
- Beim Loslassen werden Standard-Mesh, Abfrageoberfläche, Kollisionskonturen und Navigation fertiggestellt. Ein Probespiel ist währenddessen gesperrt. Jede unveränderliche Welt hält ihre eigene Abfragegeometrie, sodass eine neue Formrevision ältere Welten nicht nachträglich verändert.
- Kollisionskonturen unterstützen mehrere Körper und innere Freiräume. Der Höhenbereich wird zur Objektskalierung passend abgetastet. Fahrzeug, Navigation und Fragmente verwenden dieselben Konturen; die gesamte Fahrzeughülle muss in einen Durchbruch passen.
- Erzschichten bestehen aus lokalen Oberflächenproben mit Radius, Normalen und Dicke. Der Compiler validiert ihre Unterstützung auf derselben Formrevision. Eine nahe passende Fläche darf nachgeführt werden; eine verschwundene Fläche darf nicht auf die gegenüberliegende Tunnelwand springen. Solche Proben bleiben zur Korrektur erhalten und werden nicht schwebend gerendert.
- Die Expedition erhält eine tiefe Kopie der Erzschicht. Der Laser vermindert die Masse der getroffenen Probe. Sichtbare Mineralien, Restmenge und Fragmente verwenden diese Masse; auch Restmengen unter einer Einheit bleiben erhalten. Der Gürtel enthält 18 gemalte Vorkommen mit jeweils 12 Einheiten, sechs je Rohstoff.

## Bewusste Bereinigung

IndexedDB-Schema **3** entfernt beim Upgrade die alten lokal gespeicherten Asteroiden-Level und Asteroiden-Vorlagen dauerhaft. Planetendaten werden erhalten und auf die neue Dokumentversion gesetzt. Alte Asteroiden-JSON-Pakete werden mit einer verständlichen Meldung abgelehnt. Es gibt keine Konvertierungsschaltflächen, Erzslots oder alten GLB-Renderpfade mehr.

77 alte Asteroiden-Dateien mit insgesamt etwa 455 MiB wurden entfernt: GLBs, Metadaten, spezifische Texturen, Blender-Quellen und Exporter. Die Blender-Pipeline für Speeder und ATLAS bleibt unabhängig davon bestehen.

## Gesteinsmaterial

Die PBR-Quelle und ihr vollständiger Imagegen-Prompt stehen in [STONE-MATERIAL.md](STONE-MATERIAL.md). Drei gemeinsam genutzte, komprimierte 1024²-KTX2-Karten liefern Farbe, Normalen sowie Occlusion/Rauheit/Höhe. Räumliche Projektion, objektspezifische Versätze und mehrere Größenstufen verringern Wiederholungen. Bemalbare Masken mischen Wirtsgestein, frische Bruchflächen, Verwitterung und dunklere Varianten.

High verwendet stärkeres geometrisches Displacement als Standard. Der Schattenpass nutzt denselben Versatz. Kleine Materialdetails verändern die Flugkollision nicht. Große Bruchkanten, Überhänge und Durchbrüche gehören ins Volumen. Quader und Schnittflächen sind daher auch ohne Textur erkennbar.

```sh
python tools/generate-stone.py
node tools/encode-stone.mjs
npm run art:belt
```

Die ersten beiden Befehle backen und komprimieren die gemeinsame Oberfläche. `art:belt` schreibt den eingebauten Gürtel reproduzierbar mit vollständigen lokalen Formen und Erzschichten. Laufzeit und Levelimport brauchen weder Blender noch Python, Konto oder Server.

## Prüfung

Die Weltprüfung und das Speichern laufen jetzt außerhalb der Bedienung. Verschieben und Platzieren zeigen direkt den Körper; Pinselstriche warten beim Loslassen nicht mehr auf eine vollständige Weltberechnung. Einzelheiten, Grenzen und die zusätzliche Browserprüfung: [EDITOR-REALTIME.md](EDITOR-REALTIME.md).

- `npm test`: Formschluss an Abschnittsgrenzen, lokale Aktualisierung, alle Werkzeuge, Durchbrüche und getrennte Körper, LOD-Budgets, unveränderliche Abfragen, Material-/Erzdaten, lokale Extraktion und vollständige Lieferung aller 18 Vorkommen. Dazu bestehende Flug-, Gelände-, Audio-, Missions- und Eingabetests.
- `/tests/level-menu.html`: eingebauter Gürtel und Aster direkt bearbeiten, gespeicherten Entwurf aus der Levelauswahl öffnen, ändern, speichern und erneut öffnen.
- Die Levelauswahl lädt nur Metadaten und Theme-Daten gespeicherter Entwürfe. Formen, Oberflächenabfragen und Navigation werden erst für das ausgewählte Level berechnet. Der Start eines eigenen Levels bleibt vollständig validiert. Beim Editorstart werden Auswahlmenü und Pause ausdrücklich ausgeblendet; ein Start- oder Renderfehler beendet die unvollständige Bearbeitung und zeigt die Levelauswahl samt Fehlermeldung wieder an.
- `/tests/editor.html`: tatsächlicher IndexedDB-Upgrade auf einer wegwerfbaren Testdatenbank, Planetenerhalt, Transformationen, Undo/Redo, Theme, Speichern/Neuladen, JSON, Vorlagenunabhängigkeit und wiederholtes Probespielen mit GPU-Ressourcenzählung.
- `/tests/editor-interactions.html`: abgefangene Mausereignisse, drei Kameragesten, sichtbare Erzschichten nach Loslassen in High/Standard bei Radius 7 und 14,5, Undo/Redo, Abbrechen und Fokusverlust. Prüft auch die Reparatur alter leerer Pinselrandproben beim Laden von Entwürfen, Vorlagen und JSON; vorhandene Erzmengen bleiben unverändert.
- `/tests/sculpt-performance.html`: kontinuierlicher stillstehender Pinsel am sichtbaren Mesh, unveränderte Welt während der Vorschau, Abbrechen, Undo/Redo, Material- und Erzspray; Eingabe bis zum Rendern einschließlich Mesh-Upload und GPU-Fence. Der Bericht enthält auch Ausreißer beim Finalisieren, nicht nur Worker-Rechenzeit.
- `/tests/asteroid-performance.html`: High/Standard in 1920×1080 mit Aster-Flug, Gürtel-Abbau, zwölf großen Körpern und einer Browser-Baseline ohne Rendering.
- `/tests/visual.html`, `/tests/browser.html`, `/tests/audio.html`: Spielkamera, beide Qualitätsstufen, sichtbare Steuerungs- und Audio-Regressionen.

Aktuelle Messdaten und Bilder: [SCULPT-VALIDATION.md](SCULPT-VALIDATION.md) und `screenshots/sculpt-live/`. Die lokalen Messungen erreichten im Spiel etwa 56,8 FPS bei einer Browser-Baseline von 57,0 FPS. Die 60-FPS-Zielmarke ist damit in diesem eingebetteten Browser nicht bestätigt. Die Pinselprüfung erreicht p95 **37,7 ms** einschließlich GPU-Fence; einzelne Finalisierungspausen liegen bei bis zu 171 ms.
