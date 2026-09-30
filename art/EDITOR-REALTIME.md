# Echtzeit-Bearbeitung im Workshop

Der bisherige Engpass war vor allem die synchrone Neuerzeugung der gesamten Welt: Oberflächen, Kollisionskonturen und Anflugwege wurden nach vielen Änderungen doppelt berechnet. Anschließend wurden auch unveränderte Szenenobjekte neu aufgebaut. IndexedDB war bereits asynchron; ein Wechsel des Dateiformats allein hätte diese Pausen nicht behoben.

## Vorschau und vorbereitete Welt

- Beim Ziehen bewegt sich der sichtbare Asteroid samt Erz direkt. Die Platzierung wird erst beim Loslassen als ein Rückgängig-Schritt übernommen; Abbrechen stellt ihre Ausgangslage wieder her.
- Neue Asteroiden erhalten sofort eine einfache Silhouette mit dem gemeinsamen Gesteinsmaterial. Ein Worker berechnet die endgültige Geometrie, Abfragen, Kollision und Navigation. Auch der Zufallsgenerator zeigt sofort einen Körper und lässt andere Objekte weiter bearbeiten.
- Ein Pinselstrich wird beim Loslassen direkt in den Entwurf übernommen. Der nächste Strich kann beginnen, während die fertige Welt noch berechnet wird. Die laufende Abschnittsvorschau bleibt erhalten und wird nach dem Abschluss wieder zu einer kompakten Geometrie zusammengeführt.
- Hintergrundaufträge tragen eine Revision. Nur die aktuelle Antwort darf veröffentlicht werden; wartende Aufträge werden durch den neuesten Entwurf ersetzt. Ein laufender Strich oder eine Platzierung wird durch die Veröffentlichung nicht unterbrochen. Generatoren übernehmen ihre Ergebnisse in den aktuellen Entwurf und verwerfen Ergebnisse für inzwischen unabhängig bearbeitete Ziele.
- Im Asteroidengürtel bleiben unveränderte GPU-Geometrie, Erzobjekte und Dekoration erhalten. Nur geänderte Körper beziehungsweise Erzschichten werden ersetzt. Spielzustand und Entwurf bleiben getrennt. Probespielen wartet weiterhin auf die aktuelle validierte Welt.

## Lokaler Speicher

Speichern läuft in einem separaten Worker. Ein atomarer IndexedDB-Schreibvorgang verarbeitet einen unveränderlichen Dokumentstand, während die Bearbeitung weitergeht. Pro Level wird nur der neueste wartende Stand geschrieben. Verschiedene Level behalten jeweils ihren letzten offenen Stand. Die Anzeige „Lokal gespeichert“ bestätigt ausschließlich den aktuellen Stand nach erfolgreicher Transaktion; Fehler werden sichtbar gemeldet.

Änderungen werden nach 650 ms Ruhe gespeichert, bei fortlaufenden abgeschlossenen Änderungen spätestens nach 2,5 Sekunden angestoßen. „Speichern“ und das Verlassen des Editors stoßen die Speicherung sofort an. Die Listen gespeicherter Entwürfe und Vorlagen werden während der Bearbeitung aus einem Sitzungscache dargestellt, statt bei jedem UI-Aufbau sämtliche Formdaten erneut aus IndexedDB zu laden.

Das JSON- und IndexedDB-Datenformat bleibt erhalten. Die Worker trennen Berechnung und Speicherung von der Bedienung; eine weitere Formatmigration ist dafür nicht nötig. Der Browser muss einen Schreibvorgang trotzdem abschließen können: Ein sofortiges Beenden des gesamten Browsers kann unbestätigte Änderungen verlieren.

## Verifikation

`/tests/editor-realtime.html` prüft echte Three.js-Objekte, direkte Platzierung, Abbrechen, schnelle aufeinanderfolgende Pinselstriche, gezielte Geometrieaktualisierung, parallel laufende Generierung, Erhalt fokussierter Eingabefelder, GPU-Freigabe, aktuelle Beleuchtung im Probespiel und den tatsächlichen Speicher-Worker. Eine zusätzlich verzögerte Speicherung prüft das Zusammenfassen wartender Stände und schützt vor falschen Bestätigungen älterer Schreibvorgänge.

Die Unit-Tests prüfen verlustfreien Geometrietransfer, unveränderliche veröffentlichte Welten, stabile History-Snapshots sowie Speicherreihenfolge, Fehler, Wiederholung und Dokumentwechsel. Bestehende Editor-, Maus-/Erz- und Generator-Fixtures bleiben Teil der Regression.

Messungen und Browserprotokolle stehen unter `screenshots/editor-realtime/`. Die gemessenen synchronen Bedienungszeiten sind von der Eingabe bis zur Übernahme des Ereignisses gemessen, nicht als GPU-Latenz oder garantierte Bildrate. Große erstmalige Szenenwechsel, planetare Terrainänderungen sowie neue Shader können weiterhin Aufbauzeit benötigen. Kollision und Anflugprüfung brauchen je nach Form mehrere Sekunden im Hintergrund; das verhindert weitere Bearbeitung nicht.

Im lokalen integrierten Browser am 30.09.2026: Verschieben einschließlich Abschluss **15,6 ms**, sofortige Platzierungsvorschau **12,3 ms**, Pinselabschluss **8,8 ms**. Nach drei Platzierungs-/Undo-Zyklen blieben die temporären Geometrien freigegeben. Die Abschlussansicht hatte 402 Draw Calls, 117 Geometrien und 34 Texturen. Das sind einzelne reproduzierbare Bedienungsszenarien; die bestehende 1080p-/60-FPS-Zielmarke wird dadurch nicht als erfüllt erklärt.

Abgeschlossen: 140 Unit-Tests; 31 Echtzeit-, 32 allgemeine Editor-, 125 Maus-/Erz-, 28 Generator- und 12 Levelauswahl-Prüfungen. TypeScript und Vite-Produktionsbuild erfolgreich. Im lokalen Produktionsbuild wurden zusätzlich Menüstart, reale Tastatureingabe, Speicherbestätigung, Expedition und Editor-Rückkehr geprüft. Der Build bleibt lokal; die öffentliche Website wurde nicht aktualisiert.
