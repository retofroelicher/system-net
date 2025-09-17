/* Data layer: loads nodes.json, normalizes and provides items to the engine. */
(function(){
  const { data } = window.APP_CONFIG;

  async function loadJson(url){
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function normalizeLink(l){
    return { label: String(l.label || "Link"), href: String(l.href || "#") };
  }

  function normalizePlanet(p){
    return {
      title: String(p.title || "Detail"),
      group: String(p.group || "API & PLA"),
      desc: String(p.desc || ""),
      links: Array.isArray(p.links) ? p.links.map(normalizeLink) : []
    };
  }

  function normalizeItem(item){
    return {
      title: String(item.title || "Ohne Titel"),
      group: String(item.group || "API"),
      desc: String(item.desc || ""),
      links: Array.isArray(item.links) ? item.links.map(normalizeLink) : [],
      planets: Array.isArray(item.planets) ? item.planets.map(normalizePlanet) : []
    };
  }

  async function getItems(){
    try{
      const json = await loadJson(data.url);
      const items = Array.isArray(json.items) ? json.items.map(normalizeItem) : [];
      return items.length ? items : [
        { title: "Fallback", group: "API", desc: "Lokaler Fallback.", links: [{label:"Link", href:"#"}] }
      ];
    }catch(err){
      console.warn("Falling back to inline defaults:", err);
      return [
        { title: "Fallback", group: "API", desc: "Lokaler Fallback.", links: [{label:"Link", href:"#"}] }
      ];
    }
  }

  window.DataAPI = Object.freeze({ getItems });
})();
