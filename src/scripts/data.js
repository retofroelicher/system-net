(function(){
  const { data } = window.APP_CONFIG;

  async function loadJson(url){
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function normalizeItem(item){
    return {
      title: String(item.title || "Ohne Titel"),
      group: String(item.group || "1"),
      desc: String(item.desc || ""),
      links: Array.isArray(item.links) ? item.links.map(l => ({
        label: String(l.label || "Link"),
        href: String(l.href || "#")
      })) : []
    };
  }

  async function getItems(){
    try{
      const json = await loadJson(data.url);
      const items = Array.isArray(json.items) ? json.items.map(normalizeItem) : [];
      return items;
    }catch(err){
      console.warn("Falling back to inline defaults:", err);
      return [
        { title: "Fallback Item", group: "1", desc: "Lokaler Fallback.", links: [{label:"Link", href:"#"}] }
      ];
    }
  }

  window.DataAPI = Object.freeze({ getItems });
})();
