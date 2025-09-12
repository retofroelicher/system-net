/* Rendering & interaction engine for the wireframe sphere (no external libs). */
(function(){
  const CFG = window.APP_CONFIG;

  let rotation = { x: 0.0, y: 0.0 };
  let filterMode = "ALL";
  let rafId = null;

  // Maus-Drag
  let isDragging = false;
  let lastMouse = { x: 0, y: 0 };
  const DRAG_SENS = 0.003; // rad pro Pixel (feinfühlig)

  // Auto-Rotate Toggle-State (aus Config)
  let autoOn = CFG.autoRotate && CFG.autoRotate.enabled !== false;

  // Zoom (Kameradistanz d in der Projektionsformel)
  let cameraD = CFG.perspective; // wird per Mausrad angepasst

  const nodes = []; // {id, group, data, base{x,y,z}, pos{x,y,z}, el{g,circle,ring}, neighbors[]}
  const edges = []; // {a,b,el}

  const gEdges = () => document.getElementById("edges");
  const gNodes = () => document.getElementById("nodes");
  const svgEl  = () => document.getElementById("scene");
  const tooltip = () => document.getElementById("tooltip");
  const info = {
    title: () => document.getElementById("info-title"),
    desc:  () => document.getElementById("info-desc"),
    links: () => document.getElementById("info-links"),
    meta:  () => document.getElementById("info-meta"),
    close: () => document.getElementById("info-close")
  };

  function lerp(a,b,t){ return a + (b - a) * t; }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

  function fibonacciSphere(n){
    const pts = [];
    const phi = Math.PI * (3 - Math.sqrt(5));
    for(let i=0;i<n;i++){
      const y = 1 - (i / Math.max(1,(n - 1))) * 2;
      const radius = Math.sqrt(Math.max(0,1 - y*y));
      const theta = phi * i;
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      pts.push({x,y,z});
    }
    return pts;
  }

  function rotatePoint(p, rx, ry){
    const cosX = Math.cos(rx), sinX = Math.sin(rx);
    let y = p.y * cosX - p.z * sinX;
    let z = p.y * sinX + p.z * cosX;
    const cosY = Math.cos(ry), sinY = Math.sin(ry);
    const x = p.x * cosY + z * sinY;
    z = -p.x * sinY + z * cosY;
    return {x, y, z};
  }

  function project(p3){
    const { cx, cy, r } = CFG.sphere;
    const d = cameraD; // <-- dynamische Kameradistanz für Zoom
    const scale = d / (d - (p3.z * r));
    const x2d = cx + (p3.x * r) * scale;
    const y2d = cy + (p3.y * r) * scale;
    return { x: x2d, y: y2d, scale };
  }

  function nearestNeighbors(idx, k){
    const base = nodes[idx].base;
    const dists = nodes.map((n,i) => i===idx ? {i, d: Infinity} : {
      i, d: (n.base.x-base.x)**2 + (n.base.y-base.y)**2 + (n.base.z-base.z)**2
    });
    dists.sort((a,b)=>a.d-b.d);
    return dists.slice(0,k).map(d=>d.i);
  }

  // Gruppennamen angleichen (Unterstützung für alte und neue Daten)
  function normalizeGroup(g){
    if(!g) return "API & PLA";
    const s = String(g).trim().toUpperCase();
    if(s === "1") return "API";
    if(s === "2") return "PLA";
    if(s === "1+2" || s === "1 & 2" || s === "API & PLA" || s === "API&PLA") return "API & PLA";
    if(s === "API") return "API";
    if(s === "PLA") return "PLA";
    return "API & PLA";
  }

  function applyFilterMode(mode){
    filterMode = mode;
    clearSelection();
  }

  function passFilter(n){
    if(filterMode === "ALL") return true;
    return normalizeGroup(n.group) === filterMode;
  }

  function buildGraph(items){
    const total = CFG.nodeCount;
    const points = fibonacciSphere(total);

    // Datenpunkte gleichmässig verteilen
    const dataSlots = new Set();
    while(dataSlots.size < Math.min(items.length, total)){
      dataSlots.add(Math.floor(Math.random()*total));
    }
    const slotArr = Array.from(dataSlots);
    const fallbackGroups = ["API","PLA","API & PLA"];

    for(let i=0;i<total;i++){
      const base = points[i];
      const hasData = dataSlots.has(i);
      const data = hasData ? items[ slotArr.indexOf(i) ] : null;

      const rawGroup = data ? data.group : fallbackGroups[Math.floor(Math.random()*fallbackGroups.length)];
      const group = normalizeGroup(rawGroup);

      const node = { id:"n"+i, group, data, base:{...base}, pos:{...base}, neighbors:[], el:null };
      nodes.push(node);
    }

    // Kanten (k-NN)
    const pairSet = new Set();
    nodes.forEach((_,i)=>{
      const nn = nearestNeighbors(i, CFG.neighborsPerNode);
      nodes[i].neighbors = nn;
      nn.forEach(j=>{
        const a = Math.min(i,j), b = Math.max(i,j);
        const key = `${a}-${b}`;
        if(!pairSet.has(key)){
          pairSet.add(key);
          const line = document.createElementNS("http://www.w3.org/2000/svg","line");
          line.setAttribute("data-a", a);
          line.setAttribute("data-b", b);
          gEdges().appendChild(line);
          edges.push({a,b,el:line});
        }
      });
    });

    // Knoten-Elemente
    nodes.forEach((n,i)=>{
      const g = document.createElementNS("http://www.w3.org/2000/svg","g");
      g.classList.add("node");
      g.setAttribute("tabindex","0");
      g.setAttribute("role","button");

      const titleText = n.data ? n.data.title : `Knoten • ${n.group}`;
      g.setAttribute("aria-label", `${titleText} (${n.group})`);
      g.dataset.group = n.group;
      g.dataset.id = n.id;

      const t = document.createElementNS("http://www.w3.org/2000/svg","title");
      t.textContent = titleText;

      const ring = document.createElementNS("http://www.w3.org/2000/svg","circle");
      ring.classList.add("ring");

      const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
      c.setAttribute("r", CFG.nodeBaseSize.toString());

      g.appendChild(t);
      g.appendChild(ring);
      g.appendChild(c);
      gNodes().appendChild(g);

      n.el = { g, circle: c, ring };

      g.addEventListener("click", (evt)=>{ evt.stopPropagation(); onSelectNode(n); });
      g.addEventListener("mouseenter", (e)=> showTooltipAt(titleText, e));
      g.addEventListener("mousemove",  (e)=> moveTooltip(e));
      g.addEventListener("mouseleave", hideTooltip);
    });

    // Klick auf freie Fläche: Auswahl zurücksetzen
    svgEl().addEventListener("click", (e)=>{
      const target = e.target;
      if(target.closest && !target.closest(".node")) clearSelection();
    });
  }

  function onSelectNode(node){
    document.querySelectorAll(".node.active").forEach(el=>el.classList.remove("active"));
    node.el.g.classList.add("active");

    const has = !!node.data;
    info.title().textContent = has ? node.data.title : "Knoten";
    info.desc().textContent  = has ? node.data.desc  : "Platzhalter-Knoten ohne hinterlegte Details.";
    info.links().innerHTML   = "";

    if(has && Array.isArray(node.data.links)){
      node.data.links.forEach(l=>{
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = l.href; a.target="_blank"; a.rel="noopener noreferrer"; a.textContent = l.label;
        li.appendChild(a); info.links().appendChild(li);
      });
    }
    info.meta().textContent = `Gruppe: ${node.group}`;
  }

  function clearSelection(){
    document.querySelectorAll(".node.active").forEach(el=>el.classList.remove("active"));
    info.title().textContent = CFG.labels.defaultTitle;
    info.desc().textContent  = CFG.labels.defaultDesc;
    info.links().innerHTML   = "";
    info.meta().textContent  = "";
  }

  // Tooltip helpers
  function showTooltipAt(text, evt){
    const el = tooltip();
    el.textContent = text;
    el.hidden = false;
    moveTooltip(evt);
  }
  function moveTooltip(evt){
    const el = tooltip();
    if(el.hidden) return;
    const pad = 12;
    const x = evt.clientX + pad;
    const y = evt.clientY + pad;
    el.style.transform = `translate(${x}px, ${y}px)`;
  }
  function hideTooltip(){
    const el = tooltip();
    el.hidden = true;
  }

  function render(){
    if (autoOn) {
      rotation.x += CFG.autoRotate.x;
      rotation.y += CFG.autoRotate.y;
    }

    const depthOrder = [];
    for(let i=0;i<nodes.length;i++){
      const n = nodes[i];
      const rot = rotatePoint(n.base, rotation.x, rotation.y);
      n.pos = rot;
      const p2 = project(rot);

      const depth = clamp((rot.z + 1) / 2, 0, 1);
      const s = lerp(CFG.minScale, CFG.maxScale, depth);
      const alpha = lerp(0.45, 1.0, depth);

      n.el.circle.setAttribute("cx", p2.x.toFixed(2));
      n.el.circle.setAttribute("cy", p2.y.toFixed(2));
      n.el.circle.setAttribute("r", (CFG.nodeBaseSize * s).toFixed(2));
      n.el.circle.setAttribute("fill-opacity", alpha.toFixed(2));

      n.el.ring.setAttribute("cx", p2.x.toFixed(2));
      n.el.ring.setAttribute("cy", p2.y.toFixed(2));
      n.el.ring.setAttribute("r", (CFG.nodeBaseSize * s * 2.2).toFixed(2));

      n.el.g.style.display = passFilter(n) ? "block" : "none";
      depthOrder.push({ z: rot.z, el: n.el.g });
    }

    for(const e of edges){
      const a = nodes[e.a], b = nodes[e.b];
      if(!passFilter(a) || !passFilter(b)){ e.el.style.display = "none"; continue; }
      const a2 = project(a.pos), b2 = project(b.pos);
      const alpha = ((a.pos.z + b.pos.z) * 0.5 + 1) / 2;
      e.el.style.display = "block";
      e.el.setAttribute("x1", a2.x.toFixed(2));
      e.el.setAttribute("y1", a2.y.toFixed(2));
      e.el.setAttribute("x2", b2.x.toFixed(2));
      e.el.setAttribute("y2", b2.y.toFixed(2));
      e.el.setAttribute("stroke-opacity", (0.25 + alpha * 0.55).toFixed(2));
    }

    depthOrder.sort((a,b)=>a.z - b.z);
    depthOrder.forEach(item=>gNodes().appendChild(item.el));

    rafId = requestAnimationFrame(render);
  }

  function setupFilters(){
    const controls = document.querySelector(".controls");
    const filterButtons = Array.from(controls.querySelectorAll(".btn[data-filter]"));

    filterButtons.forEach(btn=>{
      btn.addEventListener("click", ()=>{
        filterButtons.forEach(b=>{ b.classList.remove("active"); b.setAttribute("aria-pressed","false"); });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed","true");
        applyFilterMode(btn.dataset.filter);
      });
    });

    // iOS-Toggle (Checkbox) für Auto-Rotation
    const autoInput = controls.querySelector("#toggle-auto");
    if (autoInput){
      autoInput.checked = !!autoOn; // initial aus Config
      autoInput.addEventListener("change", ()=>{
        autoOn = !!autoInput.checked;
      });
    }
  }

  function setupControls(){
    const svg = svgEl();

    // Maus-Drag mit natürlicher Y-Richtung (ziehen/stossen)
    svg.addEventListener("mousedown", (e)=>{
      isDragging = true;
      lastMouse.x = e.clientX;
      lastMouse.y = e.clientY;
      hideTooltip();
    });
    window.addEventListener("mousemove", (e)=>{
      if(!isDragging) return;
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      rotation.y += dx * DRAG_SENS;   // horizontal wie gehabt
      rotation.x -= dy * DRAG_SENS;   // invertiert: fühlt sich wie «ziehen/stossen» an
      rotation.x = clamp(rotation.x, -Math.PI/2, Math.PI/2);
      lastMouse.x = e.clientX;
      lastMouse.y = e.clientY;
    });
    window.addEventListener("mouseup", ()=>{ isDragging = false; });

    // Touch-Unterstützung
    svg.addEventListener("touchstart", (e)=>{
      if(e.touches.length !== 1) return;
      const t = e.touches[0];
      isDragging = true;
      lastMouse.x = t.clientX;
      lastMouse.y = t.clientY;
      hideTooltip();
    }, {passive:true});
    svg.addEventListener("touchmove", (e)=>{
      if(!isDragging || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - lastMouse.x;
      const dy = t.clientY - lastMouse.y;
      rotation.y += dx * DRAG_SENS;
      rotation.x -= dy * DRAG_SENS;   // invertiert
      rotation.x = clamp(rotation.x, -Math.PI/2, Math.PI/2);
      lastMouse.x = t.clientX;
      lastMouse.y = t.clientY;
    }, {passive:true});
    svg.addEventListener("touchend", ()=>{ isDragging = false; });

    // Mausrad-Zoom (über SVG)
    svg.addEventListener("wheel", (e)=>{
      // Damit die Seite nicht scrollt, während man über der Kugel zoomt
      e.preventDefault();

      const isTrackpad = Math.abs(e.deltaY) < 40; // grobe Heuristik
      const step = isTrackpad ? CFG.zoom.trackpadStep : CFG.zoom.step;

      // deltaY > 0 => rauszoomen (grösseres d), deltaY < 0 => reinzoomen (kleineres d)
      const factor = e.deltaY > 0 ? step : (1 / step);
      cameraD = clamp(cameraD * factor, CFG.zoom.min, CFG.zoom.max);
    }, { passive: false });

    info.close().addEventListener("click", clearSelection);

    window.addEventListener("blur", ()=>{ if(rafId){ cancelAnimationFrame(rafId); rafId = null; }});
    window.addEventListener("focus", ()=>{ if(!rafId) rafId = requestAnimationFrame(render); });
  }

  async function bootstrap(){
    setupFilters();
    setupControls();
    const items = await window.DataAPI.getItems();
    buildGraph(items);
    render();
  }

  window.Engine = Object.freeze({ bootstrap });
})();
