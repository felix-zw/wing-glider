# Prüfung: Echtzeit-Sculpting und Erzmalerei

Stand: 29. September 2026. Three.js/WebGL2, Windows, eingebetteter Chromium 154. Der Browser meldet eine NVIDIA RTX 5060 Ti über ANGLE/D3D11. Die Messungen gelten für diesen Rechner und diese Browserumgebung.

## Funktion und Regression

| Prüfung | Ergebnis | Protokoll |
|---|---:|---|
| TypeScript | fehlerfrei | `tsc --noEmit` |
| Produktionsbuild | erfolgreich | [Build](../screenshots/sculpt-live/build.txt) |
| Unit-Tests | 106 bestanden | [Unit](../screenshots/sculpt-live/unit-checks.txt) |
| Browser-Spielablauf | 152 bestanden | [Browser](../screenshots/sculpt-live/browser-checks.txt) |
| Editor und IndexedDB | 32 bestanden | [Editor](../screenshots/sculpt-live/editor-checks.txt) |
| Live-Sculpting und Upload | 14 bestanden | [Sculpting](../screenshots/sculpt-live/sculpt-checks.txt) |
| Web Audio | 33 bestanden | [Audio](../screenshots/sculpt-live/audio-checks.txt) |

Die Unit-Prüfungen decken alle Formwerkzeuge, kontinuierliches Abtragen, Durchbrüche, mehrere Körper, Abschnittsnähte, enge und fahrzeugbreite Durchgänge, verdeckte Laserziele und die vollständige Förderung/Lieferung aller 18 Vorkommen ab. Jede Rohstoffart liefert 72 Einheiten. Lokaler Abbau verändert nur die getroffene Oberflächenprobe; der Editorentwurf bleibt unverändert. Ganze Fragmente werden trotz Gleitkommaarithmetik als genau eine Einheit ausgegeben, echte Teilmengen bleiben erhalten.

Die Browserprüfungen verwenden echte Renderer, Worker, IndexedDB, AudioGraph und Eingabeadapter mit kontrollierten Zeiger-/Tastaturereignissen und Spielpositionen. Sie prüfen unter anderem Gas/Bremse/Drift, Gamepad/Touch, Front- und Seitendüsen, Geländeausrichtung, Terrain-CPU/GPU-Übereinstimmung, volle Fracht und Missionserfüllung in beiden Umgebungen. Das ist keine vollständige manuelle Durchflugprüfung jeder möglichen selbst gebauten Karte.

Editorprüfungen erfassen unabhängige Vorlagenkopien, Löschen der Vorlage ohne Folgen für Platzierungen, JSON ohne Vorlagenbestand, Form-/Erzspeicherung und wiederholtes Probespiel. Ein echter Schema-2→3-Upgrade auf einer isolierten Testdatenbank löscht alte Asteroidenentwürfe/Vorlagen und erhält sämtliche Planetendaten. Entfernte Erz-Trägerflächen bleiben in den Daten, erscheinen als orange Korrekturmarkierungen und lassen sich mit einem rückgängig machbaren Schritt bereinigen.

Der Build meldet weiterhin den Vite-Hinweis für JavaScript-Chunks über 500 kB: Hauptmodul 506,67 kB (gzip 185,83 kB), Three.js 542,91 kB (gzip 137,44 kB), Sculpt-Worker 19,59 kB. Das ist kein Buildfehler.

## Pinselreaktion

Die Live-Prüfung rendert in **1920 × 1080**. Gemessen wird pro Pinselaktualisierung vom Einreihen der Eingabe bis zur nach dem Renderaufruf bestätigten WebGL-GPU-Fence. Worker-Warteschlange, Triangulierung, Antwort, Geometrieaustausch und Upload sind enthalten; die Betriebssystem-/Display-Latenz vor einem DOM-Ereignis ist nicht messbar. Der gehaltene Airbrush erzeugt ungefähr 30 Aktualisierungen pro Sekunde, Bewegungen werden zusätzlich interpoliert.

- 100 bestätigte Vorschauaktualisierungen; **p95 37,7 ms**, Ziel <50 ms erreicht.
- Einzelne Ausreißer beim Abschluss/Neuaufbau: **151,8–171,0 ms**. Das Ziel gilt nicht als maximale Latenz jedes Vorgangs.
- Ein unveränderter Zeiger vertieft die Kuhle fortlaufend. Währenddessen bleiben Weltrevision und ausgewähltes Wurzelobjekt bestehen; nur betroffene Meshabschnitte werden ersetzt.
- Strg/Umschalt funktionieren auch bei stillstehendem Zeiger. Schnelle Ziehbewegungen werden in gültige Teilbewegungen aufgeteilt. Abbrechen ignoriert alte Workerantworten; ein fertiger Strich ist ein Undo-Schritt.
- Der veränderte Testkörper hat 11.976/4.532 Dreiecke (High/Standard). Die laufende Abschnittsvorschau hatte 404 Draw Calls und 130 Geometrien/31 Texturen; nach dem Strich werden wieder zusammengeführte Spielmeshes verwendet.

Die Werte sind ein gezieltes Szenario mit einem Körper und kurzen Strichen, keine Garantie für beliebig lange Bearbeitungshistorien oder sämtliche unterstützten Geräte. Rohwerte: [sculpt-checks.txt](../screenshots/sculpt-live/sculpt-checks.txt).

## Spielbetrieb und Ressourcen

Je Szene: 3 Sekunden Aufwärmen und 15 Sekunden Messung bei 1920 × 1080. Draw Calls und Dreiecke sind Mittelwerte der gesamten Szene einschließlich Schattenpässen, keine einzelnen Modellbudgets.

| Szene | Qualität | FPS | Framezeit p95 | Draw Calls | Dreiecke/Frame |
|---|---|---:|---:|---:|---:|
| Aster-Flug | High | 56,75 | 18,1 ms | 300,4 | 2.431.729 |
| Gürtel-Abbau | High | 56,78 | 18,1 ms | 306,9 | 498.675 |
| Dichte Ansicht, 12 Körper | High | 56,85 | 18,1 ms | 154,0 | 618.887 |
| Aster-Flug | Standard | 56,75 | 18,1 ms | 162,7 | 941.501 |
| Gürtel-Abbau | Standard | 56,79 | 18,1 ms | 169,1 | 192.525 |
| Dichte Ansicht, 12 Körper | Standard | 56,83 | 18,1 ms | 86,0 | 151.795 |
| RAF ohne Simulation/Rendering | — | 56,97 | 18,1 ms | — | — |

**60 FPS sind in diesem Browser nicht bestätigt.** Die Szenen erreichen nahezu dessen gemessene RAF-Baseline. Daraus folgt keine allgemeine Zusicherung von 60 FPS auf anderer Hardware oder auf Mobilgeräten. Rohdaten: [performance.json](../screenshots/sculpt-live/performance.json).

Nach dem Aufwärmen bleiben die GPU-Ressourcenzähler über 16 Level-/Qualitätswechsel stabil: Aster High 131 Geometrien/35 Texturen, Standard 131/31; Gürtel High 92/34, Standard 92/30. Sechs Editor-Neuaufbauten bleiben bei 110/32. Das belegt stabile Renderer-Zähler im geprüften Verlauf, keine vollständige Heap- oder VRAM-Byteanalyse.

Gemeinsame Steintexturen: **4.062.117 Bytes (3,87 MiB)**, drei 1024²-KTX2-Karten mit Mips. Gesamtes `public/assets`: **11.914.772 Bytes (11,36 MiB)**; das ist der Dateiumfang, kein gemessener Netzwerktransfer. 77 alte Asteroiden-Dateien mit etwa 455 MiB wurden aus dem Arbeitsbaum entfernt.

## Grundformen und Optik

| Eingebaute Form | High | Standard |
|---|---:|---:|
| Bruchplatte | 8.388 | 3.432 |
| Angeschnittener Körper | 10.140 | 3.900 |
| Länglicher Splitter | 6.708 | 2.640 |
| Quaderähnlicher Brocken | 11.552 | 4.376 |
| Felsmasse | 12.464 | 5.024 |

Alle fünf Formen liegen unter 40.000/12.000 Dreiecken. Unbearbeitete Formen werden hier in etwa 68–113 ms vollständig auf der CPU kompiliert; das ist vom inkrementellen Worker während des Strichs zu unterscheiden. Reproduzierbare Erhebung: `node --import tsx tools/sculpt-report.ts`, [asset-report.json](../screenshots/sculpt-live/asset-report.json).

Ohne Material geprüft: [Platte](../screenshots/sculpt-live/shape-slab.png), [Schnittkörper](../screenshots/sculpt-live/shape-split.png), [Quader](../screenshots/sculpt-live/shape-block.png), [Splitter](../screenshots/sculpt-live/shape-long.png), [Felsmasse](../screenshots/sculpt-live/shape-mass.png). Breite Flächen, weich angeschlagene Kanten und unterschiedliche Einschnitte bleiben sichtbar. Es gibt kein gemeinsames Kreuzspaltenmuster.

Spielkamera: [High](../screenshots/sculpt-live/belt-high.png), [Standard](../screenshots/sculpt-live/belt-standard.png), [Mineralien](../screenshots/sculpt-live/ore-closeup.png). [Schnittflächen mit Material im Editor](../screenshots/sculpt-live/editor-split-material.png), [Editor über das tatsächliche Hauptmenü](../screenshots/sculpt-live/editor-production.png). Referenz ist [das ursprüngliche Gürtel-Mockup](../output/mockups/03-asteroidenguertel.png): dunkles Gestein, kühl beleuchtete Flächen, wärmere Seiten und unregelmäßige Mineralgruppen. Die Aufnahmen dokumentieren den tatsächlich gerenderten Stand; Materialwirkung bleibt eine visuelle Beurteilung.

Die Formauflösung ist endlich (72 lokale Meter, High 49³/Standard 31³). Feine Risse und kleine Bruchplatten entstehen im Material und ändern die Flugkollision nicht. Erzmenge beruht auf lokalen Flächenproben und Schichtdicke; der Editor bietet keine beliebigen Meshimporte oder Planetensculpting. Materialquelle, Bildgenerierungsmodus und vollständiger Prompt: [STONE-MATERIAL.md](STONE-MATERIAL.md).
