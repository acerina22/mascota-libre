/* Mascota Libre — app de adopciones (JS + Neon Auth/Data API + Cloudinary) */
import { createClient } from "https://esm.sh/@neon/neon-js";

(function () {
  "use strict";

  const CFG = window.MASCOTA_LIBRE_CONFIG || {};
  const view = document.getElementById("view");

  // ─────────────── utilidades ───────────────
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
  const digits = (s) => String(s || "").replace(/\D/g, "");
  function waLink(s) {
    let d = digits(s);
    if (d.length < 8) return "";
    if (!d.startsWith("54")) d = "549" + d.replace(/^0/, "");
    return "https://wa.me/" + d;
  }
  function ago(iso) {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 60) return "hace " + Math.max(1, m) + " min";
    const h = Math.round(m / 60);
    if (h < 24) return "hace " + h + " h";
    const d = Math.round(h / 24);
    return d < 31 ? "hace " + d + (d === 1 ? " día" : " días") : new Date(iso).toLocaleDateString("es-AR");
  }
  function ageText(p) {
    const u = p.age_value === 1 ? (p.age_unit === "años" ? "año" : "mes") : p.age_unit;
    return p.age_value === 0 ? "Menos de 1 mes" : p.age_value + " " + u;
  }
  const initials = (n) => (n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  let toastT;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3000);
  }
  const statusChip = {
    disponible: '<span class="chip ok">Disponible</span>',
    en_proceso: '<span class="chip warn">En proceso de adopción</span>',
    adoptado: '<span class="chip plain">Adoptado</span>',
  };
  const reqChip = {
    pendiente: '<span class="chip warn">Pendiente</span>',
    aceptada: '<span class="chip ok">Aceptada</span>',
    rechazada: '<span class="chip bad">No avanzó</span>',
  };

  // ─────────────── configuración ───────────────
  if (!CFG.NEON_URL) {
    view.innerHTML = `<div class="card-box auth-box"><h2>Falta conectar la base de datos</h2>
      <p class="lead">Completá <code>config.js</code> con la dirección de Neon.</p></div>`;
    return;
  }
  const sb = createClient(CFG.NEON_URL, { auth: { allowAnonymous: true } });
  // Fotos: se guardan en la base como JPEG comprimido (miniatura para listas + foto grande para la ficha)
  const photoUrl = (data) => data || "";
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  function encode(img, w, h, crop, maxChars) {
    const c = document.createElement("canvas");
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (crop) { // recorte 4:5 centrado
      const r = w / h;
      if (sw / sh > r) { sw = sh * r; sx = (img.width - sw) / 2; } else { sh = sw / r; sy = (img.height - sh) / 2; }
    } else {
      const s = Math.min(1, w / Math.max(sw, sh)); w = Math.round(sw * s); h = Math.round(sh * s);
    }
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    let q = 0.82, out = c.toDataURL("image/jpeg", q);
    while (out.length > maxChars && q > 0.35) { q -= 0.08; out = c.toDataURL("image/jpeg", q); }
    if (out.length > maxChars) throw new Error("grande");
    return out;
  }
  async function makePhotos(file) {
    const img = await loadImage(file);
    try {
      return { thumb: encode(img, 400, 500, true, 75000), full: encode(img, 1200, 0, false, 440000) };
    } finally { URL.revokeObjectURL(img.src); }
  }

  // ─────────────── sesión ───────────────
  let session = null;
  let me = null; // perfil
  async function loadMe() {
    me = null;
    if (session) {
      const { data } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
      me = data;
      if (!me) {
        // primera vez: crear el perfil
        const display_name = (session.user.user_metadata?.display_name || session.user.user_metadata?.name || session.user.name || (session.user.email || "").split("@")[0]).slice(0, 80);
        const ins = await sb.from("profiles").insert({ id: session.user.id, display_name }).select("*").single();
        me = ins.data;
      }
    }
    paintNav();
  }
  function paintNav() {
    const logged = !!session;
    $("#nav-login").hidden = logged;
    const av = $("#nav-profile");
    av.hidden = !logged;
    if (logged) av.textContent = initials(me?.display_name || session.user.email);
    document.querySelectorAll("[data-auth]").forEach((el) => (el.hidden = !logged));
    loadBadge();
  }
  // Solicitudes nuevas sobre mis mascotas (contador en "Mi panel")
  let lastBadge = -1;
  async function loadBadge() {
    const b = $("#nav-badge");
    if (!session) { b.hidden = true; lastBadge = -1; return; }
    const { count } = await sb.from("adoption_requests").select("id", { count: "exact", head: true })
      .eq("status", "pendiente").neq("adopter_id", session.user.id);
    const n = count || 0;
    b.textContent = n; b.hidden = !n;
    b.setAttribute("aria-label", n + (n === 1 ? " solicitud nueva" : " solicitudes nuevas"));
    if (n > 0 && lastBadge === -1) toast(n === 1 ? "Tenés 1 solicitud de adopción para responder" : `Tenés ${n} solicitudes de adopción para responder`);
    lastBadge = n;
  }
  setInterval(() => { if (session && document.visibilityState === "visible") loadBadge(); }, 60000);
  function requireLogin(next) {
    if (session) return true;
    sessionStorage.setItem("ml_next", next || location.hash);
    location.hash = "#/ingresar";
    return false;
  }

  // ─────────────── router ───────────────
  const routes = [
    [/^#?\/?$/, viewExplore, "explorar"],
    [/^#\/mascota\/([\w-]+)$/, viewPet, "explorar"],
    [/^#\/publicar$/, viewPublish, ""],
    [/^#\/editar\/([\w-]+)$/, viewPublish, ""],
    [/^#\/panel$/, viewPanel, "panel"],
    [/^#\/refugios$/, () => viewDirectory("refugios"), "refugios"],
    [/^#\/transitos$/, () => viewDirectory("transitos"), "transitos"],
    [/^#\/perfil$/, viewProfile, ""],
    [/^#\/ingresar$/, viewAuth, ""],
  ];
  async function route() {
    const h = location.hash || "#/";
    for (const [re, fn, nav] of routes) {
      const m = h.match(re);
      if (m) {
        document.querySelectorAll("[data-nav]").forEach((a) => {
          if (a.dataset.nav === nav) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
        });
        view.innerHTML = '<div class="skeleton"></div>';
        try { await fn(m[1]); } catch (e) { console.error(e); view.innerHTML = `<div class="empty"><h2>Algo salió mal</h2><p>No pudimos cargar esta sección. Revisá tu conexión y recargá la página.</p></div>`; }
        window.scrollTo(0, 0);
        return;
      }
    }
    location.hash = "#/";
  }

  // ─────────────── flyer card ───────────────
  function flyerCard(p) {
    const img = p.photo_thumb ? `<img src="${esc(photoUrl(p.photo_thumb))}" alt="Foto de ${esc(p.name)}" loading="lazy">` : `<span class="noimg" aria-hidden="true">${p.species === "gato" ? "🐈" : "🐕"}</span>`;
    return `<a class="flyer" href="#/mascota/${p.id}">
      <div class="ph">${img}
        <div class="top"><span class="chip ${p.species}">${p.species === "gato" ? "Gato" : "Perro"}</span>${p.status === "en_proceso" ? '<span class="chip warn">En proceso</span>' : ""}</div>
        ${p.status === "adoptado" ? '<div class="stamp"><span>Adoptado</span></div>' : ""}
        <div class="ribbon"><span class="adopt">Adoptame</span><div class="nm">${esc(p.name)}</div></div>
      </div>
      <div class="info">
        <div class="facts"><span class="chip plain">${p.sex === "macho" ? "♂ Macho" : "♀ Hembra"}</span><span class="chip plain">${esc(ageText(p))}</span><span class="chip plain">${cap(p.size)}</span></div>
        <div class="loc">📍 ${esc(p.city)} · ${ago(p.created_at)}</div>
      </div></a>`;
  }

  // ─────────────── Explorar ───────────────
  const filters = { species: "", sex: "", size: "", q: "", showAdopted: false };
  async function viewExplore() {
    view.innerHTML = `
      <section class="banner">
        <div class="banner-copy">
          <span class="kicker">Red de adopción responsable y gratuita</span>
          <h1>No compres, <span class="hl">adoptá</span></h1>
          <p class="lead">Perros y gatos que buscan casa, publicados por refugios, rescatistas y vecinos. Sumate a la red: adoptá, da en adopción u ofrecete como tránsito.</p>
          <div class="actions"><a class="btn" href="#resultados" id="go-results">Quiero adoptar</a><a class="btn ghost on-dark" href="#/publicar">Dar en adopción</a></div>
          <div class="stats" id="stats"></div>
        </div>
        <div class="collage" id="collage">${collageTiles([])}</div>
      </section>
      <div class="filters">
        <div class="seg" role="group" aria-label="Especie">
          <button type="button" data-sp="" aria-pressed="${!filters.species}">Todos</button>
          <button type="button" data-sp="perro" aria-pressed="${filters.species === "perro"}">Perros</button>
          <button type="button" data-sp="gato" aria-pressed="${filters.species === "gato"}">Gatos</button>
        </div>
        <select id="f-sex" aria-label="Sexo"><option value="">Macho o hembra</option><option value="macho">Macho</option><option value="hembra">Hembra</option></select>
        <select id="f-size" aria-label="Tamaño"><option value="">Cualquier tamaño</option><option value="chico">Chico</option><option value="mediano">Mediano</option><option value="grande">Grande</option></select>
        <input id="f-q" type="search" placeholder="Buscar por ciudad, barrio o nombre" aria-label="Buscar" value="${esc(filters.q)}">
        <label class="check"><input id="f-adopted" type="checkbox" ${filters.showAdopted ? "checked" : ""}> Ver adoptados</label>
      </div>
      <div id="results" class="grid" style="scroll-margin-top:90px"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`;
    $("#f-sex").value = filters.sex; $("#f-size").value = filters.size;
    view.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
      filters.species = b.dataset.sp;
      view.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      loadResults();
    }));
    $("#f-sex").addEventListener("change", (e) => { filters.sex = e.target.value; loadResults(); });
    $("#f-size").addEventListener("change", (e) => { filters.size = e.target.value; loadResults(); });
    let qt; $("#f-q").addEventListener("input", (e) => { filters.q = e.target.value; clearTimeout(qt); qt = setTimeout(loadResults, 300); });
    $("#f-adopted").addEventListener("change", (e) => { filters.showAdopted = e.target.checked; filters.onlyAdopted = false; loadResults(); });
    $("#go-results").addEventListener("click", (e) => { e.preventDefault(); $("#results").scrollIntoView({ behavior: "smooth" }); });
    loadStats();
    loadCollage();
    await loadResults();
  }
  // Banner: fotos fijas (img/banner-*.jpg en config) + caras de mascotas publicadas
  const PAW = `<svg viewBox="0 0 24 24"><circle cx="6" cy="9" r="2.2"/><circle cx="10" cy="5.5" r="2.2"/><circle cx="14" cy="5.5" r="2.2"/><circle cx="18" cy="9" r="2.2"/><path d="M12 11c-3.2 0-6 3.6-6 6.2 0 1.6 1.2 2.3 2.6 2.3 1.3 0 2.2-.7 3.4-.7s2.1.7 3.4.7c1.4 0 2.6-.7 2.6-2.3 0-2.6-2.8-6.2-6-6.2z"/></svg>`;
  // items: {src, id?, name?}. Mascotas reales en adopción primero; si faltan, caritas de muestra.
  function collageTiles(items) {
    const fill = ["perro", "gato", "perro", "gato", "perro", "gato"];
    return fill.map((sp, i) => {
      const it = items[i];
      if (!it) return `<div class="tile t${i} ph-${sp}">${PAW}</div>`;
      const img = `<img src="${esc(it.src)}" alt="${it.name ? "Foto de " + esc(it.name) : ""}" loading="${i < 2 ? "eager" : "lazy"}">`;
      return it.id
        ? `<a class="tile t${i} real" href="#/mascota/${it.id}">${img}<span class="tag">${esc(it.name)}</span></a>`
        : `<div class="tile t${i}">${img}</div>`;
    }).join("");
  }
  async function loadCollage() {
    const { data } = await sb.from("pets").select("id, name, photo_thumb").neq("photo_thumb", "").neq("status", "adoptado").order("created_at", { ascending: false }).limit(6);
    const items = (data || []).map((r) => ({ id: r.id, name: r.name, src: r.photo_thumb }));
    (CFG.BANNER_IMAGES || []).forEach((src) => { if (items.length < 6) items.push({ src }); });
    const el = $("#collage");
    if (el && items.length) el.innerHTML = collageTiles(items);
  }
  async function loadStats() {
    const [a, b] = await Promise.all([
      sb.from("pets").select("id", { count: "exact", head: true }).neq("status", "adoptado"),
      sb.from("pets").select("id", { count: "exact", head: true }).eq("status", "adoptado"),
    ]);
    const el = $("#stats"); if (!el) return;
    el.innerHTML = `<button type="button" class="stat" data-show="esperando"><b>${a.count ?? 0}</b><span>esperando casa →</span></button><button type="button" class="stat" data-show="adoptados"><b>${b.count ?? 0}</b><span>ya adoptados →</span></button>`;
    el.querySelectorAll("[data-show]").forEach((btn) => btn.addEventListener("click", async () => {
      const adopted = btn.dataset.show === "adoptados";
      filters.showAdopted = adopted; filters.onlyAdopted = adopted;
      const chk = $("#f-adopted"); if (chk) chk.checked = adopted;
      await loadResults();
      $("#results")?.scrollIntoView({ behavior: "smooth" });
    }));
  }
  async function loadResults() {
    const box = $("#results"); if (!box) return;
    let q = sb.from("pets").select("*").order("created_at", { ascending: false }).limit(60);
    if (filters.species) q = q.eq("species", filters.species);
    if (filters.sex) q = q.eq("sex", filters.sex);
    if (filters.size) q = q.eq("size", filters.size);
    if (filters.onlyAdopted) q = q.eq("status", "adoptado");
    else if (!filters.showAdopted) q = q.neq("status", "adoptado");
    const term = filters.q.trim().replace(/[%,()]/g, " ");
    if (term) q = q.or(`city.ilike.%${term}%,name.ilike.%${term}%,breed.ilike.%${term}%`);
    const { data, error } = await q;
    if (!$("#results")) return;
    if (error) { box.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>No pudimos cargar las mascotas</h3><p>Revisá tu conexión y probá de nuevo.</p></div>`; return; }
    if (!data.length) {
      const any = filters.species || filters.sex || filters.size || term;
      box.innerHTML = `<div class="empty" style="grid-column:1/-1">${any
        ? "<h3>No hay coincidencias</h3><p>Probá con otra ciudad o sacá algún filtro.</p>"
        : '<h3>Todavía no hay mascotas publicadas</h3><p>Si tenés un perro o un gato para dar en adopción, cargá su flyer: foto, nombre, edad y zona. Aparece acá al instante.</p><a class="btn" href="#/publicar">Dar en adopción</a>'}</div>`;
      return;
    }
    box.innerHTML = data.map(flyerCard).join("");
  }

  // ─────────────── Ficha de mascota ───────────────
  async function viewPet(id) {
    const { data: p } = await sb.from("pets").select("*, owner:profiles(id, display_name, city, is_shelter, shelter_name, phone)").eq("id", id).maybeSingle();
    if (!p) { view.innerHTML = `<div class="empty"><h2>Esta publicación ya no está</h2><p>Puede que la hayan borrado.</p><a class="btn" href="#/">Ver otras mascotas</a></div>`; return; }
    const isOwner = session && session.user.id === p.owner_id;
    const ownerName = p.owner?.is_shelter && p.owner?.shelter_name ? p.owner.shelter_name : (p.owner?.display_name || "Usuario");
    let myReq = null;
    if (session && !isOwner) {
      const r = await sb.from("adoption_requests").select("*").eq("pet_id", id).eq("adopter_id", session.user.id).maybeSingle();
      myReq = r.data;
    }
    const ph = await sb.from("pet_photos").select("data").eq("pet_id", id).maybeSingle();
    const full = ph.data?.data || p.photo_thumb || "";
    const health = [["Castrado/a", p.neutered], ["Vacunas al día", p.vaccinated], ["Desparasitado/a", p.dewormed]]
      .map(([t, v]) => `<span class="chip ${v ? "ok" : "plain"}">${v ? "✓" : "–"} ${t}</span>`).join("");
    const img = full ? `<img src="${esc(full)}" alt="Foto de ${esc(p.name)}">` : `<span class="noimg" style="position:absolute;inset:0;display:grid;place-items:center;font-size:96px" aria-hidden="true">${p.species === "gato" ? "🐈" : "🐕"}</span>`;

    let action = "";
    if (isOwner) {
      action = `<div class="card-box"><h3>Es tu publicación</h3><p class="lead" style="margin-bottom:14px">Las personas interesadas te mandan una solicitud. Las ves en tu panel.</p>
        <div class="actions"><a class="btn" href="#/panel">Ver solicitudes</a><a class="btn ghost" href="#/editar/${p.id}">Editar</a></div></div>`;
    } else if (p.status === "adoptado") {
      action = `<div class="card-box"><h3>¡${esc(p.name)} ya encontró casa!</h3><p class="lead">Mirá otras mascotas que todavía esperan.</p><div class="actions" style="margin-top:12px"><a class="btn" href="#/">Ver mascotas</a></div></div>`;
    } else if (myReq) {
      action = `<div class="card-box"><h3>Ya mandaste tu solicitud</h3><p style="margin:8px 0">${reqChip[myReq.status]}</p>
        <p class="lead">${myReq.status === "aceptada" ? "¡Quien publicó aceptó tu solicitud! Se va a comunicar al contacto que dejaste." : myReq.status === "rechazada" ? "Esta vez no avanzó. Hay muchas otras mascotas esperando." : "Cuando quien publicó la lea, te va a contactar."}</p>
        ${myReq.status === "pendiente" && waLink(p.owner?.phone) ? `<a class="btn ghost" style="margin-top:12px" target="_blank" rel="noopener" href="${waLink(p.owner.phone)}?text=${encodeURIComponent(`Hola! Te mandé una solicitud en Mascota Libre para adoptar a ${p.name}. ${location.origin}${location.pathname}#/mascota/${p.id}`)}">Avisarle por WhatsApp</a>` : ""}</div>`;
    } else {
      action = `<form class="card-box" id="req-form" novalidate><h3>Quiero adoptar a ${esc(p.name)}</h3>
        <p class="lead" style="margin-bottom:14px">Contale a quien lo publicó sobre vos y tu casa. Tu contacto solo lo ve esa persona.</p>
        <div class="form-grid">
          <label class="field full">Mensaje<textarea id="r-msg" rows="4" maxlength="1000" placeholder="Dónde vivís, si tenés patio o balcón con red, otros animales, chicos, horarios…"></textarea></label>
          <label class="field full">WhatsApp o email para contactarte<input id="r-contact" maxlength="60" value="${esc(me?.phone || "")}"></label>
          <p class="err full" id="r-err" role="alert"></p>
          <button class="btn block full" type="submit">${session ? "Enviar solicitud" : "Ingresá para adoptar"}</button>
        </div></form>`;
    }

    view.innerHTML = `<p style="margin:0 0 14px"><a href="#/" style="color:var(--muted);font-weight:600;text-decoration:none">← Todas las mascotas</a></p>
      <div class="detail">
        <article class="poster">
          <div class="ph">${img}${p.status === "adoptado" ? '<div class="stamp"><span>Adoptado</span></div>' : ""}</div>
          <div class="band"><small>${p.status === "adoptado" ? "Ya tiene casa" : "Adoptame"}</small><h1>${esc(p.name)}</h1></div>
        </article>
        <div class="side">
          <div style="display:flex;gap:8px;flex-wrap:wrap"><span class="chip ${p.species}">${p.species === "gato" ? "Gato" : "Perro"}</span>${statusChip[p.status]}</div>
          <dl class="spec">
            <div><dt>Edad</dt><dd>${esc(ageText(p))}</dd></div>
            <div><dt>Sexo</dt><dd>${p.sex === "macho" ? "Macho" : "Hembra"}</dd></div>
            <div><dt>Tamaño</dt><dd>${cap(p.size)}</dd></div>
            <div><dt>Raza</dt><dd>${esc(p.breed || "Mestizo")}</dd></div>
          </dl>
          <div class="health">${health}</div>
          ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ""}
          <div class="who"><span class="avatar" aria-hidden="true">${esc(initials(ownerName))}</span>
            <div><b>${esc(ownerName)}</b>${p.owner?.is_shelter ? ' <span class="chip plain">Refugio</span>' : ""}<div class="loc" style="color:var(--muted);font-size:13px">📍 ${esc(p.city)} · publicado ${ago(p.created_at)}</div></div></div>
          ${action}
          <button class="btn ghost" id="dl-flyer" type="button">Descargar flyer para compartir</button>
        </div>
      </div>`;

    $("#dl-flyer").addEventListener("click", () => makeFlyer(p, full));
    const form = $("#req-form");
    if (form) form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!requireLogin("#/mascota/" + id)) return;
      const msg = $("#r-msg").value.trim(), contact = $("#r-contact").value.trim();
      if (!msg) return ($("#r-err").textContent = "Escribí un mensaje para quien publicó.");
      if (contact.length < 6) return ($("#r-err").textContent = "Dejá un WhatsApp o un email para que te contacten.");
      const btn = form.querySelector("button"); btn.disabled = true;
      const { error } = await sb.from("adoption_requests").insert({ pet_id: id, adopter_id: session.user.id, message: msg, contact });
      btn.disabled = false;
      if (error) { $("#r-err").textContent = error.code === "23505" ? "Ya mandaste una solicitud para esta mascota." : "No se pudo enviar. Probá de nuevo."; return; }
      toast("Solicitud enviada"); viewPet(id);
    });
  }

  // flyer descargable (1080×1350, formato historia/feed)
  function makeFlyer(p, photo) {
    const W = 1080, H = 1350, c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const css = getComputedStyle(document.documentElement);
    const accent = "#E3346F", ink = "#22183A";
    const draw = (img) => {
      g.fillStyle = "#F6F4FB"; g.fillRect(0, 0, W, H);
      const ph = 980;
      if (img) {
        const s = Math.max(W / img.width, ph / img.height);
        const w = img.width * s, h = img.height * s;
        g.drawImage(img, (W - w) / 2, (ph - h) / 2, w, h);
      } else { g.fillStyle = "#E3DEEF"; g.fillRect(0, 0, W, ph); }
      g.fillStyle = accent; g.fillRect(0, ph, W, H - ph);
      g.fillStyle = accent; g.fillRect(60, ph - 70, 330, 70);
      g.fillStyle = "#fff"; g.font = "800 44px 'Bricolage Grotesque', sans-serif"; g.fillText("ADOPTAME", 84, ph - 20);
      g.fillStyle = "#fff"; g.font = "800 120px 'Bricolage Grotesque', sans-serif"; g.fillText(p.name.slice(0, 14), 60, ph + 130);
      g.font = "600 42px 'Figtree', sans-serif";
      const line = [p.species === "gato" ? "Gato" : "Perro", p.sex === "macho" ? "Macho" : "Hembra", ageText(p), cap(p.size)].join("  ·  ");
      g.fillText(line, 60, ph + 200);
      g.font = "500 36px 'Figtree', sans-serif"; g.fillText("📍 " + p.city.slice(0, 40), 60, ph + 260);
      g.fillStyle = ink; g.font = "700 30px 'Figtree', sans-serif"; g.textAlign = "right";
      g.fillText("Mascota Libre · adopción responsable", W - 60, ph + 330);
      c.toBlob((b) => {
        if (!b) return toast("No se pudo generar el flyer");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b); a.download = "flyer-" + p.name.toLowerCase().replace(/[^a-z0-9]+/gi, "-") + ".png";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }, "image/png");
    };
    void css;
    if (!photo) return draw(null);
    const img = new Image();
    img.onload = () => draw(img); img.onerror = () => draw(null);
    img.src = photo;
  }

  // ─────────────── Publicar / editar ───────────────
  async function viewPublish(editId) {
    if (!requireLogin(location.hash)) return;
    let p = null;
    if (editId) {
      const r = await sb.from("pets").select("*").eq("id", editId).maybeSingle();
      p = r.data;
      if (!p || p.owner_id !== session.user.id) { view.innerHTML = `<div class="empty"><h2>No podés editar esta publicación</h2><a class="btn" href="#/panel">Ir a mi panel</a></div>`; return; }
    }
    const v = (k, d = "") => esc(p ? p[k] : d);
    view.innerHTML = `<div class="section-head"><div><h1>${p ? "Editar a " + esc(p.name) : "Dar en adopción"}</h1>
      <p class="lead">Una buena foto es lo que más ayuda: de cerca, con luz natural y a la altura de sus ojos.</p></div></div>
      ${!p && !me?.phone ? `<p class="notice" style="margin-bottom:16px">Sumá tu WhatsApp en <a href="#/perfil">tu perfil</a> para que te avisen apenas manden una solicitud.</p>` : ""}
      <form id="pet-form" class="card-box" novalidate><div class="form-grid">
        <label class="field full">Foto <span class="hint">JPG o PNG. La achicamos automáticamente.</span>
          <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
            <img id="p-prev" alt="" style="width:120px;height:150px;object-fit:cover;border-radius:12px;background:var(--line)" ${p?.photo_thumb ? `src="${esc(p.photo_thumb)}"` : "hidden"}>
            <input id="p-photo" type="file" accept="image/*" style="flex:1 1 200px">
          </div></label>
        <label class="field">Nombre<input id="p-name" maxlength="40" required value="${v("name")}" placeholder="Ej.: Luna"></label>
        <label class="field">Tipo de mascota<select id="p-species"><option value="perro">Perro</option><option value="gato">Gato</option></select></label>
        <label class="field">Sexo<select id="p-sex"><option value="hembra">Hembra</option><option value="macho">Macho</option></select></label>
        <label class="field">Raza <span class="hint">Si no sabés, poné Mestizo</span><input id="p-breed" maxlength="60" value="${v("breed", "Mestizo")}"></label>
        <label class="field">Edad aproximada<div style="display:flex;gap:8px"><input id="p-age" type="number" min="0" max="30" inputmode="numeric" value="${v("age_value", "1")}" style="width:90px"><select id="p-unit"><option value="meses">meses</option><option value="años">años</option></select></div></label>
        <label class="field">Tamaño<select id="p-size"><option value="chico">Chico</option><option value="mediano">Mediano</option><option value="grande">Grande</option></select></label>
        <label class="field full">Ciudad o barrio<input id="p-city" maxlength="80" required value="${v("city", me?.city || "")}" placeholder="Ej.: Caballito, CABA"></label>
        <fieldset class="full"><legend>Salud</legend>
          <label class="check"><input id="p-neutered" type="checkbox" ${p?.neutered ? "checked" : ""}> Castrado/a</label>
          <label class="check"><input id="p-vacc" type="checkbox" ${p?.vaccinated ? "checked" : ""}> Vacunas al día</label>
          <label class="check"><input id="p-dew" type="checkbox" ${p?.dewormed ? "checked" : ""}> Desparasitado/a</label>
        </fieldset>
        <label class="field full">Cómo es<textarea id="p-desc" rows="4" maxlength="1000" placeholder="Carácter, si convive con otros animales o con chicos, cuidados especiales, requisitos para adoptar…">${v("description")}</textarea></label>
        ${p ? `<label class="field">Estado<select id="p-status"><option value="disponible">Disponible</option><option value="en_proceso">En proceso de adopción</option><option value="adoptado">Adoptado</option></select></label>` : ""}
        <p class="err full" id="p-err" role="alert"></p>
        <div class="actions full" style="justify-content:flex-end">
          ${p ? '<button type="button" class="btn ghost" id="p-del">Borrar publicación</button>' : ""}
          <button class="btn" type="submit" id="p-save">${p ? "Guardar cambios" : "Publicar"}</button>
        </div></div></form>`;
    if (p) { $("#p-species").value = p.species; $("#p-sex").value = p.sex; $("#p-unit").value = p.age_unit; $("#p-size").value = p.size; $("#p-status").value = p.status; }
    else { $("#p-unit").value = "años"; $("#p-size").value = "mediano"; }

    let photos = null;
    $("#p-photo").addEventListener("change", async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      try { photos = await makePhotos(f); $("#p-prev").src = photos.thumb; $("#p-prev").hidden = false; $("#p-err").textContent = ""; }
      catch { photos = null; $("#p-err").textContent = "No pudimos leer esa imagen. Probá con otra foto (JPG o PNG)."; }
    });

    if (p) {
      const del = $("#p-del");
      del.addEventListener("click", async () => {
        if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "¿Seguro? Tocá de nuevo para borrar"; return; }
        del.disabled = true;
        const { error } = await sb.from("pets").delete().eq("id", p.id);
        if (error) { del.disabled = false; return toast("No se pudo borrar"); }
        toast("Publicación borrada"); location.hash = "#/panel";
      });
    }

    $("#pet-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#p-err"); err.textContent = "";
      const row = {
        name: $("#p-name").value.trim(), species: $("#p-species").value, sex: $("#p-sex").value,
        breed: $("#p-breed").value.trim() || "Mestizo", age_value: parseInt($("#p-age").value, 10), age_unit: $("#p-unit").value,
        size: $("#p-size").value, city: $("#p-city").value.trim(), description: $("#p-desc").value.trim(),
        neutered: $("#p-neutered").checked, vaccinated: $("#p-vacc").checked, dewormed: $("#p-dew").checked,
      };
      if (p) row.status = $("#p-status").value;
      if (!row.name) return (err.textContent = "Falta el nombre.");
      if (!row.city) return (err.textContent = "Falta la ciudad o el barrio.");
      if (!Number.isFinite(row.age_value) || row.age_value < 0 || row.age_value > 30) return (err.textContent = "La edad tiene que ser un número entre 0 y 30.");
      if (!p && !photos) return (err.textContent = "Subí una foto: es lo primero que mira quien quiere adoptar.");
      const btn = $("#p-save"); btn.disabled = true; btn.textContent = "Guardando…";
      try {
        if (photos) row.photo_thumb = photos.thumb;
        let res;
        if (p) res = await sb.from("pets").update(row).eq("id", p.id).select("id").single();
        else res = await sb.from("pets").insert({ ...row, owner_id: session.user.id }).select("id").single();
        if (res.error) throw res.error;
        if (photos) {
          const up = await sb.from("pet_photos").upsert({ pet_id: res.data.id, data: photos.full, updated_at: new Date().toISOString() });
          if (up.error) throw new Error("foto");
        }
        toast(p ? "Cambios guardados" : "¡Publicado!");
        location.hash = "#/mascota/" + res.data.id;
      } catch (ex) {
        err.textContent = ex.message === "foto" ? "No se pudo subir la foto. Probá con otra imagen o revisá tu conexión." : "No se pudo guardar. Revisá los datos y probá de nuevo.";
        btn.disabled = false; btn.textContent = p ? "Guardar cambios" : "Publicar";
      }
    });
  }

  // ─────────────── Panel ───────────────
  let panelTab = "publicadas";
  async function viewPanel() {
    if (!requireLogin("#/panel")) return;
    view.innerHTML = `<div class="section-head"><div><h1>Mi panel</h1><p class="lead">Tus publicaciones, las solicitudes que recibiste y las que mandaste.</p></div><a class="btn" href="#/publicar">Dar en adopción</a></div>
      <div class="seg tabs" role="tablist" style="width:max-content;max-width:100%">
        <button type="button" data-tab="publicadas" aria-pressed="${panelTab === "publicadas"}">Doy en adopción</button>
        <button type="button" data-tab="solicitudes" aria-pressed="${panelTab === "solicitudes"}">Quiero adoptar</button>
      </div><div id="panel-body" class="list"><div class="skeleton"></div></div>`;
    view.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { panelTab = b.dataset.tab; viewPanel(); }));
    const body = $("#panel-body");
    if (panelTab === "publicadas") {
      const { data: pets } = await sb.from("pets").select("*, requests:adoption_requests(*, adopter:profiles(display_name, city))").eq("owner_id", session.user.id).order("created_at", { ascending: false });
      if (!pets?.length) { body.innerHTML = `<div class="empty"><h3>Todavía no publicaste mascotas</h3><p>Cargá su foto y sus datos y armamos el flyer.</p><a class="btn" href="#/publicar">Dar en adopción</a></div>`; return; }
      body.innerHTML = pets.map((p) => {
        const reqs = (p.requests || []).sort((a, b) => b.created_at.localeCompare(a.created_at));
        const reqHtml = reqs.length ? reqs.map((r) => {
          const wa = waLink(r.contact);
          return `<div class="req"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${esc(r.adopter?.display_name || "Alguien")}</b>${r.adopter?.city ? `<span class="s" style="color:var(--muted);font-size:13px">· ${esc(r.adopter.city)}</span>` : ""} ${reqChip[r.status]} <span style="color:var(--muted);font-size:13px">${ago(r.created_at)}</span></div>
            <p>${esc(r.message)}</p>
            <p>Contacto: <code style="user-select:all">${esc(r.contact)}</code>${wa ? ` · <a href="${wa}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:700">WhatsApp →</a>` : ""}</p>
            ${r.status === "pendiente" ? `<div class="actions"><button class="btn small" data-accept="${r.id}" data-pet="${p.id}">Aceptar</button><button class="btn ghost small" data-reject="${r.id}">No avanza</button></div>` : ""}</div>`;
        }).join("") : `<p class="s" style="color:var(--muted);font-size:13px;margin:10px 0 0">Todavía no hay solicitudes.</p>`;
        return `<div class="card-box" style="padding:14px"><div class="row" style="border:0;padding:0">
          ${p.photo_thumb ? `<img src="${esc(photoUrl(p.photo_thumb))}" alt="">` : `<span class="thumb">${p.species === "gato" ? "🐈" : "🐕"}</span>`}
          <div><div class="t">${esc(p.name)}</div><div class="s">${statusChip[p.status]} · ${reqs.length} solicitud${reqs.length === 1 ? "" : "es"}</div></div>
          <div class="actions">${p.status !== "adoptado" ? `<button class="btn dark small" data-adopted="${p.id}">Marcar adoptado</button>` : ""}<a class="btn ghost small" href="#/editar/${p.id}">Editar</a><a class="btn ghost small" href="#/mascota/${p.id}">Ver</a></div>
        </div>${reqHtml}</div>`;
      }).join("");
      body.addEventListener("click", async (e) => {
        const b = e.target.closest("button"); if (!b) return;
        b.disabled = true;
        let error;
        if (b.dataset.accept) {
          ({ error } = await sb.from("adoption_requests").update({ status: "aceptada" }).eq("id", b.dataset.accept));
          if (!error) await sb.from("pets").update({ status: "en_proceso" }).eq("id", b.dataset.pet).eq("status", "disponible");
          if (!error) toast("Aceptada. Contactá a la persona para coordinar.");
        } else if (b.dataset.reject) {
          ({ error } = await sb.from("adoption_requests").update({ status: "rechazada" }).eq("id", b.dataset.reject));
        } else if (b.dataset.adopted) {
          ({ error } = await sb.from("pets").update({ status: "adoptado" }).eq("id", b.dataset.adopted));
          if (!error) toast("¡Qué lindo! Marcado como adoptado");
        }
        if (error) { b.disabled = false; return toast("No se pudo guardar el cambio"); }
        loadBadge();
        viewPanel();
      });
    } else {
      const { data: reqs } = await sb.from("adoption_requests").select("*, pet:pets(id, name, species, photo_thumb, city, status)").eq("adopter_id", session.user.id).order("created_at", { ascending: false });
      if (!reqs?.length) { body.innerHTML = `<div class="empty"><h3>No mandaste solicitudes todavía</h3><p>Cuando una mascota te guste, entrá a su flyer y tocá "Quiero adoptar".</p><a class="btn" href="#/">Ver mascotas</a></div>`; return; }
      body.innerHTML = reqs.map((r) => `<div class="row">
        ${r.pet?.photo_thumb ? `<img src="${esc(photoUrl(r.pet.photo_thumb))}" alt="">` : `<span class="thumb">🐾</span>`}
        <div><div class="t">${esc(r.pet?.name || "Publicación borrada")}</div><div class="s">${reqChip[r.status]} · enviada ${ago(r.created_at)}</div></div>
        <div class="actions">${r.pet ? `<a class="btn ghost small" href="#/mascota/${r.pet.id}">Ver</a>` : ""}${r.status === "pendiente" ? `<button class="btn ghost small" data-cancel="${r.id}">Retirar</button>` : ""}</div></div>`).join("");
      body.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-cancel]"); if (!b) return;
        if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "¿Seguro?"; return; }
        b.disabled = true;
        const { error } = await sb.from("adoption_requests").delete().eq("id", b.dataset.cancel);
        if (error) { b.disabled = false; return toast("No se pudo retirar"); }
        toast("Solicitud retirada"); viewPanel();
      });
    }
  }

  // ─────────────── Refugios y tránsitos ───────────────
  async function viewDirectory(kind) {
    const shelters = kind === "refugios";
    const col = shelters ? "is_shelter" : "is_foster";
    const { data } = await sb.from("profiles").select("*").eq(col, true).order("created_at", { ascending: false }).limit(300);
    const already = me && me[col];
    const head = shelters
      ? { t: "Refugios y rescatistas", l: "Organizaciones y personas que rescatan, cuidan y dan en adopción.", cta: "¿Tenés un refugio o rescatás animales?", ctaL: "Sumá tu refugio al directorio y publicá tus mascotas con su nombre.", btn: "Sumar mi refugio" }
      : { t: "Hogares de tránsito", l: "Personas que reciben una mascota en su casa por un tiempo, hasta que encuentre familia definitiva.", cta: "¿Podés ser tránsito?", ctaL: "Un tránsito le salva la vida a un animal mientras espera adopción. Anotate y los refugios te pueden contactar.", btn: "Ofrecerme como tránsito" };
    view.innerHTML = `<div class="section-head"><div><h1>${head.t}</h1><p class="lead">${head.l}</p></div></div>
      ${already ? "" : `<div class="cta-band"><div><h3>${head.cta}</h3><p>${head.ctaL}</p></div><a class="btn" href="#/perfil" data-want="${col}">${head.btn}</a></div>`}
      <div class="dir" id="dir"></div>`;
    view.querySelector("[data-want]")?.addEventListener("click", () => sessionStorage.setItem("ml_want", col));
    const dir = $("#dir");
    if (!data?.length) { dir.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>Todavía no hay ${shelters ? "refugios" : "tránsitos"} anotados</h3><p>Podés ser el primero.</p></div>`; return; }
    dir.innerHTML = data.map((u) => {
      const name = shelters ? (u.shelter_name || u.display_name) : u.display_name;
      const wa = waLink(u.phone);
      const fosterInfo = !shelters ? `<div style="display:flex;gap:6px;flex-wrap:wrap"><span class="chip ${u.foster_species === "gato" ? "gato" : u.foster_species === "perro" ? "perro" : "plain"}">${u.foster_species === "ambos" ? "Perros y gatos" : u.foster_species === "perro" ? "Perros" : "Gatos"}</span><span class="chip plain">Hasta ${u.foster_capacity}</span></div>${u.foster_notes ? `<p style="margin:0;color:var(--muted);font-size:14px;overflow-wrap:anywhere">${esc(u.foster_notes)}</p>` : ""}` : "";
      return `<article class="person"><div class="who"><span class="avatar">${esc(initials(name))}</span><div><h3 style="font-size:18px">${esc(name || "Sin nombre")}</h3>${u.city ? `<div style="color:var(--muted);font-size:13px">📍 ${esc(u.city)}</div>` : ""}</div></div>
        ${fosterInfo}${shelters && u.bio ? `<p style="margin:0;font-size:14px;overflow-wrap:anywhere">${esc(u.bio)}</p>` : ""}
        ${u.phone ? `<div class="phone"><code>${esc(u.phone)}</code><button class="btn ghost small" data-copy="${esc(u.phone)}">Copiar</button>${wa ? `<a href="${wa}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:700;font-size:14px">WhatsApp →</a>` : ""}</div>` : ""}
      </article>`;
    }).join("");
    dir.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-copy]"); if (!b) return;
      try { await navigator.clipboard.writeText(b.dataset.copy); toast("Teléfono copiado"); } catch { toast(b.dataset.copy); }
    });
  }

  // ─────────────── Perfil ───────────────
  async function viewProfile() {
    if (!requireLogin("#/perfil")) return;
    if (!me) await loadMe();
    const want = sessionStorage.getItem("ml_want"); sessionStorage.removeItem("ml_want");
    const u = Object.assign({}, me || {});
    if (want === "is_shelter") u.is_shelter = true;
    if (want === "is_foster") u.is_foster = true;
    view.innerHTML = `<div class="section-head"><div><h1>Mi perfil</h1><p class="lead">${esc(session.user.email)}</p></div><button class="btn ghost" id="logout" type="button">Cerrar sesión</button></div>
      <form id="prof" class="card-box" novalidate><div class="form-grid">
        <label class="field">Tu nombre<input id="u-name" maxlength="80" value="${esc(u.display_name || "")}"></label>
        <label class="field">Ciudad o barrio<input id="u-city" maxlength="80" value="${esc(u.city || "")}"></label>
        <label class="field full">WhatsApp o teléfono <span class="hint">Es visible para los demás: sirve para que quienes quieran adoptar te avisen por WhatsApp y, si sos refugio o tránsito, para que te contacten.</span><input id="u-phone" maxlength="30" inputmode="tel" value="${esc(u.phone || "")}"></label>
        <fieldset class="full"><legend>Cómo querés participar</legend>
          <label class="check"><input type="checkbox" checked disabled> Adoptar y dar en adopción</label>
          <label class="check"><input id="u-shelter" type="checkbox" ${u.is_shelter ? "checked" : ""}> Soy refugio o rescatista</label>
          <label class="check"><input id="u-foster" type="checkbox" ${u.is_foster ? "checked" : ""}> Me ofrezco como tránsito</label>
        </fieldset>
        <div class="full form-grid" id="shelter-box" ${u.is_shelter ? "" : "hidden"}>
          <label class="field full">Nombre del refugio<input id="u-sname" maxlength="100" value="${esc(u.shelter_name || "")}"></label>
          <label class="field full">Sobre el refugio<textarea id="u-bio" rows="3" maxlength="600" placeholder="Qué hacen, zona, cómo ayudar, alias para donaciones…">${esc(u.bio || "")}</textarea></label>
        </div>
        <div class="full form-grid" id="foster-box" ${u.is_foster ? "" : "hidden"}>
          <label class="field">Puedo recibir<select id="u-fsp"><option value="ambos">Perros y gatos</option><option value="perro">Solo perros</option><option value="gato">Solo gatos</option></select></label>
          <label class="field">Cuántos a la vez<input id="u-fcap" type="number" min="1" max="50" value="${esc(u.foster_capacity || 1)}"></label>
          <label class="field full">Detalles <span class="hint">Patio, otros animales, por cuánto tiempo, zona</span><textarea id="u-fnotes" rows="3" maxlength="400">${esc(u.foster_notes || "")}</textarea></label>
        </div>
        <p class="err full" id="u-err" role="alert"></p>
        <div class="actions full" style="justify-content:flex-end"><button class="btn" type="submit">Guardar perfil</button></div>
      </div></form>`;
    $("#u-fsp").value = u.foster_species || "ambos";
    $("#u-shelter").addEventListener("change", (e) => ($("#shelter-box").hidden = !e.target.checked));
    $("#u-foster").addEventListener("change", (e) => ($("#foster-box").hidden = !e.target.checked));
    $("#logout").addEventListener("click", async () => { try { await sb.auth.signOut(); } catch {} await refreshSession(); toast("Sesión cerrada"); location.hash = "#/"; });
    $("#prof").addEventListener("submit", async (e) => {
      e.preventDefault();
      const row = {
        display_name: $("#u-name").value.trim(), city: $("#u-city").value.trim(), phone: $("#u-phone").value.trim(),
        is_shelter: $("#u-shelter").checked, shelter_name: $("#u-sname").value.trim(), bio: $("#u-bio").value.trim(),
        is_foster: $("#u-foster").checked, foster_species: $("#u-fsp").value,
        foster_capacity: Math.min(50, Math.max(1, parseInt($("#u-fcap").value, 10) || 1)), foster_notes: $("#u-fnotes").value.trim(),
      };
      if (!row.display_name) return ($("#u-err").textContent = "Poné tu nombre.");
      if (row.is_shelter && !row.shelter_name) return ($("#u-err").textContent = "Poné el nombre del refugio.");
      if ((row.is_shelter || row.is_foster) && digits(row.phone).length < 6) return ($("#u-err").textContent = "Para aparecer en el directorio dejá un teléfono de contacto.");
      const wasFoster = !!me?.is_foster, wasShelter = !!me?.is_shelter;
      const btn = e.submitter || $("#prof button[type=submit]"); btn.disabled = true;
      const { error } = await sb.from("profiles").update(row).eq("id", session.user.id);
      btn.disabled = false;
      if (error) return ($("#u-err").textContent = "No se pudo guardar. Probá de nuevo.");
      await loadMe(); toast("Perfil guardado");
      if (row.is_foster && !wasFoster) location.hash = "#/transitos";
      else if (row.is_shelter && !wasShelter) location.hash = "#/refugios";
    });
  }

  // ─────────────── Ingresar / registrarse ───────────────
  let authMode = "login";
  async function viewAuth() {
    if (session) { location.hash = sessionStorage.getItem("ml_next") || "#/"; sessionStorage.removeItem("ml_next"); return; }
    const reg = authMode === "registro";
    view.innerHTML = `<div class="auth-box card-box">
      <div class="seg" role="tablist" style="margin-bottom:18px"><button type="button" data-m="login" aria-pressed="${!reg}" style="flex:1">Ingresar</button><button type="button" data-m="registro" aria-pressed="${reg}" style="flex:1">Crear cuenta</button></div>
      <h2>${reg ? "Creá tu cuenta" : "Hola de nuevo"}</h2>
      <p class="lead" style="margin-bottom:16px">${reg ? "Con una cuenta podés publicar, pedir adopciones y sumarte como refugio o tránsito." : "Ingresá con tu email y contraseña."}</p>
      <form id="auth" novalidate style="display:flex;flex-direction:column;gap:12px">
        ${reg ? '<label class="field">Tu nombre<input id="a-name" autocomplete="name" maxlength="80"></label>' : ""}
        <label class="field">Email<input id="a-email" type="email" autocomplete="email" required></label>
        <label class="field">Contraseña ${reg ? '<span class="hint">Mínimo 6 caracteres</span>' : ""}<input id="a-pass" type="password" autocomplete="${reg ? "new-password" : "current-password"}" minlength="6" required></label>
        <p class="err" id="a-err" role="alert"></p>
        <button class="btn block" type="submit">${reg ? "Crear cuenta" : "Ingresar"}</button>
        ${reg ? "" : '<button class="btn ghost block" type="button" id="a-forgot">Olvidé mi contraseña</button>'}
      </form></div>`;
    view.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => { authMode = b.dataset.m; viewAuth(); }));
    $("#a-forgot")?.addEventListener("click", async () => {
      const email = $("#a-email").value.trim();
      if (!email) return ($("#a-err").textContent = "Escribí tu email y tocá de nuevo.");
      let error = null;
      try { ({ error } = await sb.auth.requestPasswordReset({ email, redirectTo: location.origin + location.pathname })); } catch (ex) { error = ex; }
      $("#a-err").textContent = error ? "No se pudo enviar el email. Probá más tarde." : "";
      if (!error) toast("Te mandamos un email para cambiar la contraseña");
    });
    $("#auth").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#a-email").value.trim(), pass = $("#a-pass").value, errEl = $("#a-err");
      errEl.textContent = "";
      if (!email.includes("@")) return (errEl.textContent = "Revisá el email.");
      if (pass.length < 6) return (errEl.textContent = "La contraseña tiene que tener al menos 6 caracteres.");
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
      const why = (err) => (err && (err.message || err.statusText || err.code)) ? " (" + (err.message || err.statusText || err.code) + ")" : "";
      try {
        if (authMode === "registro") {
          const name = $("#a-name").value.trim();
          if (!name) { btn.disabled = false; return (errEl.textContent = "Poné tu nombre."); }
          const { error } = await sb.auth.signUp.email({ email, password: pass, name });
          if (error) {
            btn.disabled = false;
            return (errEl.textContent = /exist|already|registered/i.test(error.message || error.code || "") ? "Ese email ya tiene cuenta. Ingresá." : "No se pudo crear la cuenta" + why(error) + ".");
          }
        } else {
          const { error } = await sb.auth.signIn.email({ email, password: pass });
          if (error) {
            btn.disabled = false;
            return (errEl.textContent = /invalid|password|credential/i.test(error.message || error.code || "") ? "Email o contraseña incorrectos." : "No se pudo ingresar" + why(error) + ".");
          }
        }
      } catch (ex) {
        btn.disabled = false;
        return (errEl.textContent = "No se pudo conectar" + why(ex) + ".");
      }
      btn.disabled = false;
      await refreshSession();
      if (!session) return (errEl.textContent = "Se creó la sesión pero no se pudo leer. Recargá la página.");
      const next = sessionStorage.getItem("ml_next") || "#/";
      sessionStorage.removeItem("ml_next");
      toast("¡Hola" + (me?.display_name ? ", " + me.display_name : "") + "!");
      location.hash = next;
    });
  }

  // ─────────────── arranque ───────────────
  async function refreshSession() {
    try {
      const { data } = await sb.auth.getSession();
      session = data?.session && data?.user ? { ...data.session, user: data.user } : null;
    } catch { session = null; }
    await loadMe();
  }
  (async function start() {
    window.__mlStarted = true;
    await refreshSession();
    window.addEventListener("hashchange", route);
    route();
  })();
})();
