window.APP_CONFIG = Object.freeze({
  sphere: { cx: 500, cy: 350, r: 300 },
  nodeCount: 60,
  neighborsPerNode: 3,
  // Auto-Rotation standardmässig AUS
  autoRotate: { x: 0.0006, y: 0.0016, enabled: false },

  // Kamera/Projektion
  perspective: 900, // Basis-Kameradistanz (grösser = weiter weg)

  // Zoom-Einstellungen (Mausrad)
  zoom: {
    min: 500,      // näheste Kameradistanz (kleiner = näher/ grösserer Ball)
    max: 2200,     // fernste Kameradistanz
    step: 1.15,    // Zoomfaktor pro "Zahn" am Mausrad
    trackpadStep: 1.05 // feinere Schritte für Trackpads / kleine deltaY
  },

  nodeBaseSize: 5.5,
  minScale: 0.55,
  maxScale: 1.35,
  labels: {
    defaultTitle: "Wähle einen Knotenpunkt",
    defaultDesc: "Klicke auf einen Punkt, um Details und Links zu sehen.",
    placeholderDesc: "Platzhalter-Knoten ohne hinterlegte Details.",
    metaGroup: "Gruppe"
  },
  data: {
    // Pfad relativ zum Projektstamm (index.html liegt im Root)
    url: "data/nodes.json"
  }
});
