# system-net

Interaktive 3D-ähnliche Kugel-Darstellung eines Netzwerkes mit SVG (Projection + Rotation).

## Funktionen
* Rotation per Drag (Maus / Touch)
* Zoom mit Mausrad / Trackpad
* Filter nach Gruppen (API / PLA / API & PLA)
* Klick auf einen Knotenpunkt öffnet ein Popover mit Titel, Beschreibung und Links
* Tooltip beim Überfahren eines Knotens
* Tastatur: Tab fokussiert Knoten, Enter / Space selektiert, Escape schliesst Popover

## Farb-Codierung
| Gruppe | Farbe |
|--------|-------|
| API | `#8ea9db` |
| PLA | `#ffe699` |
| API & PLA | `#b9f4c9` (pastell-grün) |

## Entwicklung
Keine Build-Tools nötig. Einfach `index.html` im Browser öffnen.

## Dateien
* `index.html` – Grundstruktur & UI
* `src/styles/styles.css` – Layout & Interaktion Styles
* `src/scripts/config.js` – Konfiguration (Kugel, Zoom, Node-Parameter)
* `src/scripts/data.js` – Laden & Normalisieren von `data/nodes.json`
* `src/scripts/engine.js` – Rendering, Projektion, Events, Popover
* `src/scripts/main.js` – Bootstrap (DOMContentLoaded)

## Bedienung
1. Seite öffnen
2. Einen Punkt anklicken → Popover erscheint
3. Leere Fläche anklicken oder Escape drücken → Popover schliesst
4. Mit Mausrad zoomen, gedrückt ziehen zum Drehen

## Erweiterungsideen
* Physikalisches Clustering / Gruppierung
* Animiertes Ein-/Ausblenden beim Filtern
* Tastatur-Fokus Ring optimieren / Focus-Trap im Popover

## Lizenz
Interner Prototyp / Demo.