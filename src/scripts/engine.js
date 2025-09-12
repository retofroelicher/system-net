/* Rendering & interaction engine with popover (no external libs). */
(function(){
  const CFG = window.APP_CONFIG;

  let rotation = { x: 0.0, y: 0.0 };
  let filterMode = "ALL";
  let rafId = null;

  // Maus-Drag
  let isDragging = false;
  let lastMouse = { x: 0, y: 0 };
  const DRAG_SENS = 0.003; // rad/px

  // Auto-Rotate
  let autoOn = CFG.autoRotate && CFG.autoRotate.enabled !== false;

  // Zoom (Kameradistanz)
  let cameraD = CFG.perspective;

  const nodes = []; // {id, group, data, base, pos, screen{x,y}, el, neighbors[]}
  const edges = [];

  const gEdges = () => document.getElementById("edges");
  const gNodes = () => document.getElementById("nodes");
  const svgEl  = () => document.getElementById("scene");
  const tooltip = () => document.getElementById("tooltip");
  const pop = () => document.getElementById("popover");
  const popEls = {
    title: () => document.getElementById("pop-title"),
    desc:  () => document.getElementById("pop-desc"),
    links: () => document.getElementById("pop-links"),
    close: () => document.getElementById("pop-close")
  };

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
    const d = cameraD;
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

  // Alte/neue Gruppennamen abgleichen
  function normalizeGroup(g){
    if(!g) return "API & PLA";
    const s = String(g).trim().toUpperCase();
    if(s === "1") return "API";
    if(s === "2") return "PLA";
    if(s === "1+2" || s === "1 & 2" || s === "API&PLA" || s === "API & PLA") return "API & PLA";
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
      const group = normalizeGroup(data ? data.group : fallbackGroups[Math.floor(Math.random()*fallbackGroups.length)]);
      nodes.push({ id:"n"+i, group, data, base:{...base}, pos:{...base}, screen:{x:0,y:0}, neighbors:[], el:null });
    }

    // Kanten
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
      g.setAttribute("tabindex","0"); g.setAttribute("role","button");
      const titleText = n.data ? n.data.title : `Knoten • ${n.group}`;
      g.setAttribute("aria-label", `${titleText} (${n.group})`);
      g.dataset.group = n.group; g.dataset.id = n.id;

      const t = document.createElementNS("http://www.w3.org/2000/svg","title");
      t.textContent = titleText;

      const ring = document.createElementNS("http://www.w3.org/2000/svg","circle");
      ring.classList.add("ring");

      const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
      c.setAttribute("r", CFG.nodeBaseSize.toString());

      g.appendChild(t); g.appendChild(ring); g.appendChild(c);
      gNodes().appendChild(g);
      n.el = { g, circle: c, ring };

      // Interaktionen
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

  function fillPopover(node){
    const has = !!node.data;
    popEls.title().textContent = has ? node.data.title : "Knoten";
    popEls.desc().textContent  = has ? node.data.desc  : "Platzhalter-Knoten ohne hinterlegte Details.";
    popEls.links().innerHTML   = "";
    if(has && Array.isArray(node.data.links)){
      node.data.links.forEach(l=>{
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = l.href; a.target="_blank"; a.rel="noopener noreferrer"; a.textContent = l.label;
        li.appendChild(a); popEls.links().appendChild(li);
      });
    }
  }

  function positionPopoverAt(node){
    const svg = svgEl();
    const p = pop();
    if(p.hidden) return;

    const svgRect = svg.getBoundingClientRect();
    const viewW = 1000, viewH = 700; // aus viewBox
    const sx = svgRect.left + (node.screen.x / viewW) * svgRect.width;
    const sy = svgRect.top  + (node.screen.y / viewH) * svgRect.height;

    // Erst messen (sichtbar halten, sonst getBoundingClientRect ist 0)
    const popRect = p.getBoundingClientRect();
    const margin = 12;
    let left = sx - popRect.width/2;
    left = clamp(left, svgRect.left + margin, svgRect.right - popRect.width - margin);

    // Standard: oberhalb
    let top = sy - popRect.height - 14;
    let placement = "top";

    // Falls knapp am oberen Rand -> unten anzeigen
    if(top < svgRect.top + 48){
      top = sy + 14;
      placement = "bottom";
    }

    // Pfeil horizontal ausrichten (Position innerhalb des Popovers)
    const arrowX = clamp(sx - left, 14, popRect.width - 14);

    p.dataset.placement = placement;
    p.style.setProperty("--arrow-x", `${Math.round(arrowX)}px`);
    p.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function onSelectNode(node){
    // Aktiv markieren
    document.querySelectorAll(".node.active").forEach(el=>el.classList.remove("active"));
    node.el.g.classList.add("active");

    // Popover füllen + anzeigen
    fillPopover(node);
    const p = pop();
    p.hidden = false;
    positionPopoverAt(node);
  }

  function clearSelection(){
    document.querySelectorAll(".node.active").forEach(el=>el.classList.remove("active"));
    pop().hidden = true;
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
    el.style.transform = `translate(${evt.clientX + pad}px, ${evt.clientY + pad}px)`;
  }
  function hideTooltip(){ tooltip().hidden = true; }

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

      // Position + Tiefe
      n.screen.x = p2.x; n.screen.y = p2.y;

      const depth = (rot.z + 1) / 2;
      const s = (CFG.minScale + (CFG.maxScale - CFG.minScale) * clamp(depth,0,1));
      const alpha = (0.45 + (1.0 - 0.45) * clamp(depth,0,1));

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

    // Kanten
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

    // Zeichenreihenfolge (z-Index)
    depthOrder.sort((a,b)=>a.z - b.z);
    depthOrder.forEach(item=>gNodes().appendChild(item.el));

    // Falls Popover offen ist, an aktive Node anheften
    if(!pop().hidden){
      const active = document.querySelector(".node.active");
      if(active){
        const id = active.dataset.id;
        const n = nodes.find(nn => nn.id === id);
        if(n) positionPopoverAt(n);
      }
    }

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

    const autoInput = controls.querySelector("#toggle-auto");
    if (autoInput){
      autoInput.checked = !!autoOn;
      autoInput.addEventListener("change", ()=>{ autoOn = !!autoInput.checked; });
    }
  }

  function setupControls(){
    const svg = svgEl();

    // Drag (ziehen/stossen)
    svg.addEventListener("mousedown", (e)=>{
      isDragging = true; lastMouse.x = e.clientX; lastMouse.y = e.clientY; hideTooltip();
    });
    window.addEventListener("mousemove", (e)=>{
      if(!isDragging) return;
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      rotation.y += dx * DRAG_SENS;
      rotation.x -= dy * DRAG_SENS;
      rotation.x = clamp(rotation.x, -Math.PI/2, Math.PI/2);
      lastMouse.x = e.clientX; lastMouse.y = e.clientY;
    });
    window.addEventListener("mouseup", ()=>{ isDragging = false; });

    // Touch
    svg.addEventListener("touchstart", (e)=>{
      if(e.touches.length !== 1) return;
      const t = e.touches[0];
      isDragging = true; lastMouse.x = t.clientX; lastMouse.y = t.clientY; hideTooltip();
    }, {passive:true});
    svg.addEventListener("touchmove", (e)=>{
      if(!isDragging || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - lastMouse.x;
      const dy = t.clientY - lastMouse.y;
      rotation.y += dx * DRAG_SENS;
      rotation.x -= dy * DRAG_SENS;
      rotation.x = clamp(rotation.x, -Math.PI/2, Math.PI/2);
      lastMouse.x = t.clientX; lastMouse.y = t.clientY;
    }, {passive:true});
    svg.addEventListener("touchend", ()=>{ isDragging = false; });

    // Zoom (Mausrad)
    svg.addEventListener("wheel", (e)=>{
      e.preventDefault();
      const isTrackpad = Math.abs(e.deltaY) < 40;
      const step = isTrackpad ? CFG.zoom.trackpadStep : CFG.zoom.step;
      const factor = e.deltaY > 0 ? step : (1 / step);
      cameraD = clamp(cameraD * factor, CFG.zoom.min, CFG.zoom.max);
    }, { passive: false });

    // Popover schliessen
    popEls.close().addEventListener("click", clearSelection);
    window.addEventListener("resize", ()=>{ if(!pop().hidden){ const active = document.querySelector(".node.active"); if(active){ /* position in render aktualisiert */ } }});

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
