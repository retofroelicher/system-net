window.APP_CONFIG = Object.freeze({
  sphere: { cx: 500, cy: 350, r: 300 },
  nodeCount: 60,
  neighborsPerNode: 3,
  autoRotate: { x: 0.0006, y: 0.0016, enabled: false },

  perspective: 900,

  zoom: {
    min: 500,
    max: 2200,
    step: 1.15,
    trackpadStep: 1.05
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
    url: "./data/nodes.json"
  }
});
