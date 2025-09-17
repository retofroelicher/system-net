/* Rendering & interaction engine with popover (click hit-testing hardened). */
(function(){
  const CFG = window.APP_CONFIG;

  let rotation = { x: 0.0, y: 0.0 };
  let filterMode = "ALL";
  let rafId = null;
  let animating = false;      // läuft aktuell eine Frame-Schleife
  let dirty = true;           // Szene benötigt Update

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
  // Modal-Refs
  const modal = () => document.getElementById('modal');
  const backdrop = () => document.getElementById('modal-backdrop');
  const modalEls = {
    title: () => document.getElementById('modal-title'),
    desc:  () => document.getElementById('modal-desc'),
    links: () => document.getElementById('modal-links'),
    close: () => document.getElementById('modal-close')
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
    invalidate(); // sofort neu rendern
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
    nodes.forEach((n)=>{
      const g = document.createElementNS("http://www.w3.org/2000/svg","g");
      g.classList.add("node");
      g.setAttribute("tabindex","0");
      g.setAttribute("role","button");
      const titleText = n.data ? n.data.title : `Knoten • ${n.group}`;
      g.setAttribute("aria-label", `${titleText} (${n.group})`);
      g.dataset.group = n.group; 
      g.dataset.id = n.id;
      if(n.data){
        g.dataset.hasData = "1";
      }

  const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
  // Erste projizierte Position setzen, damit sofort klickbar (vor erstem render())
  const p0 = project(n.base);
  c.setAttribute('cx', p0.x.toFixed(2));
  c.setAttribute('cy', p0.y.toFixed(2));
  c.setAttribute("r", String(Math.max(8, CFG.nodeBaseSize * 1.2))); // kompakter initial
      // Title Element für native Tooltips als Fallback
      const t = document.createElementNS("http://www.w3.org/2000/svg","title");
      t.textContent = titleText;
      g.appendChild(t);
      g.appendChild(c);
      gNodes().appendChild(g);
      n.el = { g, circle: c };

      // Interaktionen: Click direkt am Node (robust) + Keyboard
      g.addEventListener('click', (evt)=>{
        evt.stopPropagation();
        onSelectNode(n);
      });
      // Interaktionen (Keyboard weiterhin direkt am Node)
      g.addEventListener("keydown", (evt)=>{
        if(evt.key === "Enter" || evt.key === " "){
          evt.preventDefault();
          onSelectNode(n);
        }
      });
      g.addEventListener("mouseenter", (e)=> showTooltipAt(titleText, e));
      g.addEventListener("mousemove",  (e)=> moveTooltip(e));
      g.addEventListener("mouseleave", hideTooltip);
    });

    // Klick auf freie Fläche: Auswahl zurücksetzen
    svgEl().addEventListener("click", (e)=>{
      // Nur löschen, wenn der Klick NICHT auf/innerhalb eines Node-Groups war
      if(e.defaultPrevented) return;
      const target = e.target;
      const isNodeClick = !!(target.closest && target.closest('.node'));
      if(!isNodeClick){
        clearSelection();
      }
    });
    // Nach Aufbau erste Darstellung anfordern
    invalidate();
  }

  function fillModal(node){
    const has = !!node.data;
    modalEls.title().textContent = has ? node.data.title : "Knoten";
    modalEls.desc().textContent  = has ? node.data.desc  : "Platzhalter-Knoten ohne hinterlegte Details.";
    const list = modalEls.links();
    list.innerHTML = "";
    if(has && Array.isArray(node.data.links) && node.data.links.length){
      node.data.links.forEach(l=>{
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = l.href; a.target="_blank"; a.rel="noopener noreferrer"; a.textContent = l.label;
        li.appendChild(a); list.appendChild(li);
      });
    } else {
      // Optional: eine leere Zeile oder gar nichts anzeigen
      // list bleibt leer
    }
  }
  function openModal(){
    const b = backdrop(); const m = modal();
    // Entferne Attribut und setze die Property
    if(b.hasAttribute('hidden')) b.removeAttribute('hidden');
    if(m.hasAttribute('hidden')) m.removeAttribute('hidden');
    b.hidden = false; m.hidden = false;
    // Inline-Display als Fallback (falls [hidden]-Styles noch greifen)
    b.style.display = 'block';
    m.style.display = 'flex';
    // Fokus auf Close-Button setzen (kleines UX-Plus)
    const closeBtn = modalEls.close();
    if (closeBtn) {
      // per RAF nach Layout
      requestAnimationFrame(()=> closeBtn.focus());
    }
  }
  function closeModal(){
    const b = backdrop(); const m = modal();
    b.setAttribute('hidden','');
    m.setAttribute('hidden','');
    b.hidden = true; m.hidden = true;
    // Inline-Styles zur fccksetzen
    b.style.display = '';
    m.style.display = '';
  }

  function onSelectNode(node){
    if(!node) return;
    document.querySelectorAll('.node.active').forEach(el=>el.classList.remove('active'));
    node.el.g.classList.add('active');
    fillModal(node);
    openModal();
    invalidate();
  }

  function clearSelection(){
    document.querySelectorAll('.node.active').forEach(el=>el.classList.remove('active'));
    closeModal();
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
    // Vollständiges Re-Project nur wenn dirty oder animierende Zustände
    if(!(dirty || isAnimatingState())) return; // nichts zu tun

    if(isAnimatingState()){
      // Nur bei echter Animation Rotation weiterführen
      if(autoOn){
        rotation.x += CFG.autoRotate.x;
        rotation.y += CFG.autoRotate.y;
      }
      // Während Drag aktualisiert mousemove bereits rotation.*; hier kein Zusatz.
    }

    const depthOrder = [];
    for(let i=0;i<nodes.length;i++){
      const n = nodes[i];
      const rot = rotatePoint(n.base, rotation.x, rotation.y);
      n.pos = rot;
      const p2 = project(rot);
  const depth = (rot.z + 1) / 2; // depth 0..1
      const s = (CFG.minScale + (CFG.maxScale - CFG.minScale) * clamp(depth,0,1));
  const minR = 10; // kleinerer Mindest-Radius
      const calcR = CFG.nodeBaseSize * s;

      // Nur Attribute setzen wenn geändert (kleine Optimierung)
      const cx = p2.x.toFixed(2), cy = p2.y.toFixed(2), r = Math.max(minR, calcR).toFixed(2);
      if(n.el.circle.getAttribute('cx') !== cx) n.el.circle.setAttribute('cx', cx);
      if(n.el.circle.getAttribute('cy') !== cy) n.el.circle.setAttribute('cy', cy);
      if(n.el.circle.getAttribute('r') !== r)  n.el.circle.setAttribute('r', r);

      const show = passFilter(n);
      if(!show){
        if(n.el.g.style.display !== 'none') n.el.g.style.display = 'none';
      }else{
        if(n.el.g.style.display === 'none') n.el.g.style.display = '';
        depthOrder.push({ z: rot.z, el: n.el.g });
      }
      n.screen.x = p2.x; n.screen.y = p2.y;
    }

    // Kanten aktualisieren
    for(const e of edges){
      const a = nodes[e.a], b = nodes[e.b];
      const show = passFilter(a) && passFilter(b);
      if(!show){
        if(e.el.style.display !== 'none') e.el.style.display = 'none';
        continue;
      }
      const a2 = project(a.pos), b2 = project(b.pos);
      const x1 = a2.x.toFixed(2), y1 = a2.y.toFixed(2), x2 = b2.x.toFixed(2), y2 = b2.y.toFixed(2);
      if(e.el.getAttribute('x1') !== x1) e.el.setAttribute('x1', x1);
      if(e.el.getAttribute('y1') !== y1) e.el.setAttribute('y1', y1);
      if(e.el.getAttribute('x2') !== x2) e.el.setAttribute('x2', x2);
      if(e.el.getAttribute('y2') !== y2) e.el.setAttribute('y2', y2);
      if(e.el.style.display === 'none') e.el.style.display = '';
      const alpha = ((a.pos.z + b.pos.z) * 0.5 + 1) / 2;
      const sop = (0.25 + alpha * 0.55).toFixed(2);
      if(e.el.getAttribute('stroke-opacity') !== sop) e.el.setAttribute('stroke-opacity', sop);
    }

    // Depth sort nur wenn es sichtbare Nodes gibt
    if(depthOrder.length){
      depthOrder.sort((a,b)=>a.z - b.z);
      depthOrder.forEach(item=>gNodes().appendChild(item.el));
    }

    // Modal benötigt keine Repositionierung, bleibt mittig
    dirty = false;
  }

  function isAnimatingState(){
    return isDragging || autoOn; // Bedingungen für kontinuierliche Frames
  }

  function frame(){
    render();
    if(isAnimatingState() || dirty){
      rafId = requestAnimationFrame(frame);
    } else {
      animating = false; // stoppen
    }
  }

  function requestFrame(){
    if(!animating){
      animating = true;
      rafId = requestAnimationFrame(frame);
    }
  }

  function invalidate(){
    dirty = true; requestFrame();
  }

  function invalidatePopover(){
    // Popover braucht nur Repositionierung -> treat as dirty
    invalidate();
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
      autoInput.addEventListener("change", ()=>{ 
        const newState = !!autoInput.checked;
        if(newState !== autoOn){
          autoOn = newState;
          if(autoOn){
            // sofort Animation starten
            requestFrame();
          } else {
            // einmal neu zeichnen (finaler Frame sichert Endzustand)
            invalidate();
          }
        }
      });
    }
  }

  function setupControls(){
    const svg = svgEl();

  // Drag (ziehen/stossen)
    svg.addEventListener("mousedown", (e)=>{
      isDragging = true; lastMouse.x = e.clientX; lastMouse.y = e.clientY; hideTooltip(); requestFrame();
    });
    window.addEventListener("mousemove", (e)=>{
      if(!isDragging) return;
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      rotation.y += dx * DRAG_SENS;
      rotation.x -= dy * DRAG_SENS;
      rotation.x = clamp(rotation.x, -Math.PI/2, Math.PI/2);
      lastMouse.x = e.clientX; lastMouse.y = e.clientY;
      dirty = true; // Positionsänderung
    });
    window.addEventListener("mouseup", ()=>{ if(isDragging){ isDragging = false; invalidate(); } });

    // Touch
    svg.addEventListener("touchstart", (e)=>{
      if(e.touches.length !== 1) return;
      const t = e.touches[0];
      isDragging = true; lastMouse.x = t.clientX; lastMouse.y = t.clientY; hideTooltip(); requestFrame();
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
      dirty = true;
    }, {passive:true});
    svg.addEventListener("touchend", ()=>{ if(isDragging){ isDragging = false; invalidate(); } });

    // Zoom (Mausrad)
    svg.addEventListener("wheel", (e)=>{
      e.preventDefault();
      const isTrackpad = Math.abs(e.deltaY) < 40;
      const step = isTrackpad ? CFG.zoom.trackpadStep : CFG.zoom.step;
      const factor = e.deltaY > 0 ? step : (1 / step);
      cameraD = clamp(cameraD * factor, CFG.zoom.min, CFG.zoom.max);
      invalidate();
    }, { passive: false });

  // Modal schliessen
  modalEls.close().addEventListener('click', clearSelection);
  backdrop().addEventListener('click', clearSelection);

    // Delegierter Click (Fallback / Robustheit)
    // Delegierter Click (Bubble-Phase) als Fallback
    gNodes().addEventListener('click', (e)=>{
      const g = e.target.closest('.node');
      if(g){
        const id = g.dataset.id;
        const node = nodes.find(n=>n.id===id);
        if(node) onSelectNode(node);
        e.stopPropagation(); // verhindert Hintergrund-Clear
      }
    });

    // ESC schliesst Modal
    window.addEventListener('keydown', (e)=>{
      if(e.key === 'Escape'){ clearSelection(); }
    });

    // Resize / OrientationChange -> neu zeichnen
    window.addEventListener('resize', ()=>{
      invalidate();
    });
  }

  async function bootstrap(){
    setupFilters();
    setupControls();
    // (Optionales Debug-Logging entfernt)
    const items = await window.DataAPI.getItems();
    buildGraph(items);
    requestFrame(); // initial Frame (dirty=true aus buildGraph)
  }

  window.Engine = Object.freeze({ bootstrap });
})();
