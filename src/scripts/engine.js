(function(){
  const CFG = window.APP_CONFIG;

  let rotation = { x: 0.0, y: 0.0 };
  let filterMode = "ALL";
  let rafId = null;

  const nodes = [];
  const edges = [];

  const gEdges = () => document.getElementById("edges");
  const gNodes = () => document.getElementById("nodes");
  const info = {
    title: () => document.getElementById("info-title"),
    desc: () => document.getElementById("info-desc"),
    links: () => document.getElementById("info-links"),
    meta: () => document.getElementById("info-meta"),
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
    const d = CFG.perspective;
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

  function applyFilterMode(mode){
    filterMode = mode;
    clearSelection();
  }

  function passFilter(n){
    if(filterMode === "ALL") return true;
    return n.group === filterMode;
  }

  function buildGraph(items){
    const total = CFG.nodeCount;
    const points = fibonacciSphere(total);

    const dataSlots = new Set();
    while(dataSlots.size < Math.min(items.length, total)){
      dataSlots.add(Math.floor(Math.random()*total));
    }
    const slotArr = Array.from(dataSlots);
    const groups = ["1","2","1+2"];

    for(let i=0;i<total;i++){
      const base = points[i];
      const hasData = dataSlots.has(i);
      const data = hasData ? items[ slotArr.indexOf(i) ] : null;
      const group = data ? data.group : groups[Math.floor(Math.random()*groups.length)];
      nodes.push({ id:"n"+i, group, data, base:{...base}, pos:{...base}, neighbors:[], el:null });
    }

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

    nodes.forEach((n,i)=>{
      const g = document.createElementNS("http://www.w3.org/2000/svg","g");
      g.classList.add("node");
      g.setAttribute("tabindex","0");
      g.setAttribute("role","button");
      g.setAttribute("aria-label", n.data ? `${n.data.title} (${n.group})` : `Knoten ${i+1} (Gruppe ${n.group})`);
      g.dataset.group = n.group;
      g.dataset.id = n.id;

      const ring = document.createElementNS("http://www.w3.org/2000/svg","circle");
      ring.classList.add("ring");

      const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
      c.setAttribute("r", CFG.nodeBaseSize.toString());

      g.appendChild(ring);
      g.appendChild(c);
      gNodes().appendChild(g);

      n.el = { g, circle: c, ring };

      g.addEventListener("click", ()=> onSelectNode(n));
      g.addEventListener("keydown", (e)=>{
        if(e.key === "Enter" || e.key === " "){ e.preventDefault(); onSelectNode(n); }
      });
    });
  }

  function onSelectNode(node){
    document.querySelectorAll(".node.active").forEach(el=>el.classList.remove("active"));
    node.el.g.classList.add("active");

    const has = !!node.data;
    info.title().textContent = has ? node.data.title : CFG.labels.defaultTitle;
    info.desc().textContent  = has ? node.data.desc  : CFG.labels.placeholderDesc;

    info.links().innerHTML = "";
    if(has && Array.isArray(node.data.links)){
      node.data.links.forEach(l=>{
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = l.href; a.target="_blank"; a.rel="noopener noreferrer"; a.textContent = l.label;
        li.appendChild(a); info.links().appendChild(li);
      });
    }
    info.meta().textContent = `${CFG.labels.metaGroup}: ${node.group}`;
  }

  function clearSelection(){
    document.querySelectorAll(".node.active").forEach(el=>el.classList.remove("active"));
    info.title().textContent = CFG.labels.defaultTitle;
    info.desc().textContent  = CFG.labels.defaultDesc;
    info.links().innerHTML   = "";
    info.meta().textContent  = "";
  }

  function render(){
    rotation.x += CFG.autoRotate.x;
    rotation.y += CFG.autoRotate.y;

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
    const buttons = Array.from(document.querySelectorAll(".filters .btn"));
    buttons.forEach(btn=>{
      btn.addEventListener("click", ()=>{
        buttons.forEach(b=>{ b.classList.remove("active"); b.setAttribute("aria-pressed","false"); });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed","true");
        applyFilterMode(btn.dataset.filter);
      });
    });
  }

  function setupControls(){
    document.getElementById("info-close").addEventListener("click", clearSelection);
    window.addEventListener("keydown", (e)=>{
      const step = 0.06;
      if(e.key === "ArrowLeft") rotation.y -= step;
      if(e.key === "ArrowRight") rotation.y += step;
      if(e.key === "ArrowUp") rotation.x -= step;
      if(e.key === "ArrowDown") rotation.x += step;
    });
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
