# Asteroiden generieren und globaler Bearbeitungsverlauf

Im linken Bereich des Weltraum-Editors steht **Asteroiden-Generator**. **Zufallsasteroid platzieren** wählen und anschließend im Flugraum klicken. Der neue Asteroid gehört vollständig zum Level und kann wie jede andere Form modelliert, bemalt, dupliziert oder als Vorlage gespeichert werden. Die Option **Neuer Asteroid mit Erz & Leuchten** erstellt auch Erzschichten, Oberflächenleuchten und einen inneren Leuchtbereich.

Für eine vorhandene Auswahl gibt es rechts **Auswahl generieren**:

- **Form neu generieren** ersetzt das modellierte Volumen durch eine zufällige Variante. Breite Bruchflächen, Proportionen, Neigung und Ausbrüche variieren; es gibt fünf Grundformfamilien. Materialparameter, Materialmalerei, Leuchten und Erzschichten bleiben erhalten. Erzstellen, deren Trägerfläche verloren geht, werden wie beim Sculpting als ungültig markiert.
- **Erze neu generieren** ersetzt die gewählten Rohstoffschichten auf diesem Asteroiden. Andere Rohstoffe, andere Objekte, Form und Oberflächengestaltung bleiben erhalten. Die Schichten werden an wirklichen Dreiecksflächen in erreichbarer Flughöhe erzeugt; Fläche, Dicke und Objektskalierung bestimmen ihre Menge. Lieferziele bleiben separat einstellbar.
- **Oberflächenleuchten generieren** ersetzt die bisherige Leuchtmalerei. Andere Materialmasken, Kern, Erze und Geometrie bleiben erhalten. Der vorhandene Spaltenregler moduliert das Leuchten im Gesteinsmaterial.
- **Inneres generieren** setzt Farbe, Stärke, Position und Radien des inneren Leuchtbereichs. Die Auswahl bevorzugt freigelegte Innenflächen. Die übrige Oberflächenmalerei und die Form bleiben erhalten.
- **Alles neu generieren** erzeugt diese Bereiche gemeinsam als einen Schritt.

Grundform, Ausbrüche, Erzdichte, Rohstoffauswahl und warme/kühle Leuchtpalette stehen links. **Neuer Zufall bei jedem Aufruf** erzeugt einen neuen Seed. Ausschalten und denselben Seed verwenden, um eine Generation auf derselben Ausgangsform reproduzierbar zu wiederholen. Die Generatoren besitzen getrennte Zufallsfolgen.

Die Berechnung läuft in einem Worker. Bis zum fertigen Ergebnis bleibt der bisherige Entwurf sichtbar. **Esc** oder **Rückgängig** bricht eine laufende Generation ab. Ein abgebrochener Worker kann später keine Änderungen nachreichen. Probespielen wartet auf die fertige Weltrevision.

**Rückgängig / Wiederholen** im Kopfbereich verwendet einen gemeinsamen Verlauf für alle Levelbearbeitungen: Platzierungen, Transformationen, Startpunkt/ATLAS, Geländeparameter, Theme, Himmels- und Lampeneinstellungen, Material- und Erzmalerei sowie Generatoren. Jeder abgeschlossene Pinselstrich und jede Generation ist ein Schritt. **Strg+Z** macht rückgängig; **Strg+Umschalt+Z** oder **Strg+Y** wiederholt, auch mit einem fokussierten Eigenschaftenfeld. Der Verlauf bleibt beim Probespielen erhalten. Ein anderer Levelentwurf oder Neuladen startet seinen eigenen Verlauf; der lokale Speicher enthält den aktuellen Entwurf.

Generierte Varianten sind optionale Formdaten in `SculptDefinition` Version 2. Bereits vorhandene Formen bleiben lesbar. Formen, Masken, Erze und Leuchten werden vollständig mit dem Level exportiert; die Vorlage ist keine Laufzeitabhängigkeit. Varianten sind Teil der Geometriesignatur und aktualisieren Rendergeometrie, Oberflächenabfragen und Kollision gemeinsam. Die Grenzen von 40.000/12.000 Dreiecken gelten weiterhin.

Prüfung: `src/asteroid-generator.test.ts` kontrolliert Reproduzierbarkeit, geschlossene Oberflächen, Dreieckslimits, Cachewechsel, gültige Erzanker, Mengen, getrennte Kanäle und JSON. `/tests/generator.html` prüft Worker, Abbruch, globale Tastenkürzel, genaue Undo-/Redo-Rundläufe, unabhängige Kopien, Speicherung und den tatsächlichen Renderer. Protokoll und Ansicht liegen in `screenshots/generator/`.
