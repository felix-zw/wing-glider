# Fluglage, Rückwärtsfahrt, Asteroiden und Audio

Stand: 28. September 2026. Diese Ergänzung baut auf der bestehenden Three.js-Grafiküberarbeitung auf; frühere Asset-Quellen und Prüfberichte bleiben erhalten.

## Umgesetzt

- **Steuerung:** S, Pfeil ab, Leertaste beziehungsweise der linke Gamepad-Trigger bremsen zuerst. Weiteres Halten fährt langsam rückwärts, begrenzt auf **6 m/s**. Vorwärtsschub bremst eine Rückwärtsbewegung zunächst ab; ohne Eingabe gleitet das Fahrzeug zum Stillstand aus.
- **Geländeflug:** Neigung und Höhe folgen dem gemeinsamen Höhenfeld. Die geglättete Fluglage wird erneut auf Bodenfreiheit geprüft, damit Nase und beide Gondeln auch an Kuppen und Seitenhängen frei bleiben. Simulation und Darstellung verwenden dieselbe Fahrzeugpose und denselben daraus berechneten Laserursprung. Die Geschützausrichtung bleibt beim Neigen stabil; im Weltraum entfällt die Geländeneigung.
- **Asteroiden:** Geschlossene, unregelmäßig triangulierte Körper mit Bruchflächen, feinen kantigen Rissen und Vertiefungen ersetzen die ringförmige Geometrie. Dunklere matte Materialien, unterschiedlich verjüngte Ober-/Unterseiten und 19–24 teilweise eingebettete Felsblöcke je Körper geben ihnen mehr steiniges Relief. Die sichtbaren Flanken im Abbaubereich stimmen mit den maßgeblichen Kollisionskonturen überein. Jeder Körper bleibt ein Mesh mit weniger als 10.000 Dreiecken.
- **Audio:** Lokale Web-Audio-Synthese erzeugt Triebwerkssummen, Abbaulaser, Gesteinsbruch, Einsammeln, Entladen und Wüstenwind. Der Wind läuft ausschließlich auf Aster; das Triebwerk reagiert auch auf Rückwärtsfahrt. Es werden keine Audiodateien oder externen Dienste geladen.
- **Audio-Bedienung:** Lautstärke und Stummschaltung im Pausemenü werden lokal gespeichert. Der Browser schaltet Audio durch eine Nutzergeste frei. Pause, versteckter Tab, Tod, Neustart und Levelwechsel unterdrücken alte Ereignisse und laufende Klänge; die Freigabe der Audioressourcen ist wiederholbar.

## Nachgewiesene Prüfungen

- **65 Unit-Tests bestanden**, einschließlich Fahrtrichtungswechsel, Fahrzeugpose und Audio-Ereigniserkennung.
- **Produktionsbuild bestanden:** TypeScript und Vite erfolgreich. Die bestehende Größenwarnung für das Three.js-Bundle bleibt bestehen.
- **Produktionsvorschau geprüft:** Asteroidengürtel mit finaler Geometrie, regulärem HUD und Audioeinstellungen geladen und pausiert; keine Konsolenfehler. Lautstärkeregler und Stummschaltung zuvor im Spiel per Tastatur bedient, nach Neuladen wiedergefunden und anschließend auf die Ausgangswerte 55 % / Ton an zurückgesetzt.
- **Alle Browser-Integrationstests bestanden:** echte GLB-Geometrie über Hängen und Kuppen, Steuerung, Abbau/Lieferung, Ressourcenfreigabe während des Ladens und stabile GPU-Objektzahlen nach wiederholten Level-/Qualitätswechseln. Der kleinste gemessene Abstand des tatsächlichen Fahrzeugmodells zum Gelände betrug in diesen Prüfszenen **1,16 m**. Die Geländezielbestimmung lag bei **0,05 ms pro Probe**. [Vollständiges Browserprotokoll](../screenshots/flight-audio-asteroids/browser-checks.txt).
- **Alle Audio-Integrationstests bestanden:** echter AudioContext, wiederholte Freischaltung, getrennte Aster-/Weltraum-Layer, Rückwärtsfahrt, einzelne Ereignistöne, Pause/Stumm/Tod/Reset und Entsorgung. Der OfflineAudioContext lieferte für alle sechs Klangtypen endliche, hörbare Signale ohne Clipping sowie einen stillen Ausklang; Masterlautstärke null ergab digitale Stille. [Vollständiges Audioprotokoll](../screenshots/flight-audio-asteroids/audio-checks.txt).
- Die Prüfung erfolgte automatisiert. **Ein physisches Gamepad und eine menschliche Hörabnahme wurden nicht als geprüft ausgewiesen.** Die Offline-Signalmessung ersetzt keine klangliche Hörbewertung.

## Aktuelle Spielansichten

- [Fahrzeug am Anstieg](../screenshots/flight-audio-asteroids/vehicle-uphill.jpg)
- [Fahrzeug am Seitenhang](../screenshots/flight-audio-asteroids/vehicle-sidehill.jpg)
- [Audioeinstellungen im Pausemenü](../screenshots/flight-audio-asteroids/audio-settings.jpg)
- [Überarbeitete Asteroiden und Kristalle](../screenshots/flight-audio-asteroids/belt-crystals.jpg)
- [Asteroidenübersicht](../screenshots/flight-audio-asteroids/belt-mining.jpg)
- [Produktionsbuild mit Spiel-HUD](../screenshots/flight-audio-asteroids/production-belt.jpg)

## Finale Leistungsmessung

Codex In-app Browser / Chromium 154, ANGLE D3D11, vom Browser gemeldete NVIDIA GeForce RTX 5060 Ti (Hardwareidentität nicht unabhängig geprüft). Hoch, tatsächlicher Zeichenpuffer **1920 × 1080**, je Szene 3 Sekunden Aufwärmen und 60 Sekunden Messung. Die Grafikfixture misst Darstellung und Simulation; Audio wurde separat mit den oben verlinkten Prüfungen untersucht.

| Szene | Mittlere FPS | p95 | Längster Frame | Mittlere Drawcalls |
| --- | ---: | ---: | ---: | ---: |
| Ruhiger Flug | 56,56 | 18,10 ms | 18,60 ms | 328 |
| Abbau auf Aster | 56,62 | 18,10 ms | 18,60 ms | 289 |
| Sturm im Schutzbereich | 56,64 | 18,10 ms | 18,60 ms | 312 |
| Abbau im Asteroidengürtel | 56,62 | 18,10 ms | 18,70 ms | 214 |

Die frischen zehnsekündigen RAF-Vergleiche ohne Simulation und WebGL-Rendering erreichten **56,51 FPS mit Statusanzeige** beziehungsweise **56,57 FPS ohne DOM-Updates**, jeweils p95 18,10 ms. Die Spielszenen liegen damit auf dem Grundtakt dieser Browsersitzung; das belegt keine Leistungsreserve auf anderer Hardware. Im Vergleich zur vorherigen Sitzung mit etwa 60 Hz darf die andere Browser-Taktung nicht als Renderregression interpretiert werden.

**Das strikte Ziel von mindestens 60 FPS ist weiterhin nicht bestätigt.** Der p95-Grenzwert unter 20 ms ist in allen vier Szenen erfüllt; die FPS-Grenze wird unverändert als nicht bestanden ausgewiesen.

[Rohdaten und RAF-Baseline](../screenshots/flight-audio-asteroids/benchmark-high-1080p.json) · [Lesbarer Bericht](../screenshots/flight-audio-asteroids/benchmark-high-1080p.txt).
