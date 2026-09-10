#!/usr/bin/env node
/**
 * Regenera admin/index.html a partir de index.html (la landing publica del coordinador).
 *
 * Uso: desde la raiz de portafolio_inmuebles ->
 *   node scripts/build-admin.js
 *
 * Que hace:
 *  1. Lee index.html y extrae cada <article class="card"> / "card featured".
 *  2. Decodifica la foto (base64) de cada inmueble y la guarda en images/{id}.{ext}.
 *  3. Arma el link "Subastar" con los mismos parametros que ya usa el juego
 *     (fmi, nombre, ciudad, area, avaluo, imagen).
 *  4. Escribe admin/index.html con el diseño de mosaico + animaciones + login
 *     de Supabase (Auth con correo/contraseña de los admins reales), con TODOS
 *     los inmuebles que haya en ese momento en index.html.
 *
 * Correlo cada vez que el coordinador cambie/agregue/quite inmuebles en index.html,
 * y luego sube admin/index.html (y las fotos nuevas en images/, si las hay) con git.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC_HTML = path.join(ROOT, "index.html");
const IMAGES_DIR = path.join(ROOT, "images");
const OUT_HTML = path.join(ROOT, "admin", "index.html");

const HOST_BASE = "https://subasta-web.onrender.com/host";
const SITE_IMAGES_BASE = "https://portafolio-inmuebles.onrender.com/images";

// Supabase (Auth con correo/contraseña) para el login del panel interno.
// La "publishable key" esta pensada para ser publica (va en el HTML igual).
const SUPABASE_URL = "https://vazzjcgcqyxechiwrqjv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_XchKwzcsUTDcepEcaw_gqg_B6Q8CBQe";

// Fecha/hora de la proxima ronda de subasta para el contador del panel
// interno. No hay forma de saberla automaticamente (no existe un
// calendario/agenda en el sistema) -- el equipo la actualiza aqui a mano
// cada vez que se agenda la siguiente ronda. Formato ISO con offset de
// Colombia (-05:00).
const PROXIMA_SUBASTA_ISO = "2026-09-23T15:00:00-05:00";

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function formatFechaLarga(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getDate()} de ${MESES_ES[d.getMonth()]}`;
}

function countdownBannerHtml(nextItem) {
  return `    <div class="countdown-banner">
      <p class="countdown-date"><span class="countdown-dot"></span>Próxima ronda · ${escapeHtml(formatFechaLarga(PROXIMA_SUBASTA_ISO))}</p>
      <div class="countdown-clock" data-target="${PROXIMA_SUBASTA_ISO}">
        <div class="countdown-box"><span class="countdown-num" data-unit="dias">00</span><span class="countdown-label">Días</span></div>
        <span class="countdown-sep">:</span>
        <div class="countdown-box"><span class="countdown-num" data-unit="hrs">00</span><span class="countdown-label">Hrs</span></div>
        <span class="countdown-sep">:</span>
        <div class="countdown-box"><span class="countdown-num" data-unit="min">00</span><span class="countdown-label">Min</span></div>
        <span class="countdown-sep">:</span>
        <div class="countdown-box"><span class="countdown-num" data-unit="seg">00</span><span class="countdown-label">Seg</span></div>
      </div>
    </div>
`;
}

function readSource() {
  if (!fs.existsSync(SRC_HTML)) {
    console.error("No encontre index.html en " + SRC_HTML);
    process.exit(1);
  }
  return fs.readFileSync(SRC_HTML, "utf-8");
}

function extractCards(html) {
  const re = /<article class="card( featured)?">([\s\S]*?)<\/article>/g;
  const cards = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    cards.push(m[2]);
  }
  return cards;
}

function unescapeHtml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function parsePrice(rawText) {
  const text = rawText.trim();
  let m = text.match(/^\$?\s*([\d.]+)/);
  if (m) {
    const digits = m[1].replace(/\./g, "");
    if (digits.length > 0) return { value: parseInt(digits, 10), ok: true };
  }
  m = text.match(/([\d.,]+)\s*MIL\s*MILLONES/i);
  if (m) {
    const n = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
    return { value: Math.round(n * 1_000_000_000), ok: true };
  }
  m = text.match(/([\d.,]+)\s*MILLONES/i);
  if (m) {
    const n = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
    return { value: Math.round(n * 1_000_000), ok: true };
  }
  return { value: 0, ok: false };
}

function parseArea(specHtml) {
  const m = specHtml.match(/<b>([\d.,]+)\s*m²<\/b>/);
  if (!m) return { value: 0, ok: false };
  const n = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
  return { value: n, ok: !isNaN(n) };
}

function parseCard(body, index) {
  const warnings = [];

  const imgMatch = body.match(/<img src="(data:(image\/[a-zA-Z0-9.+-]+);base64,([^"]+))"/);
  if (!imgMatch) {
    warnings.push("sin imagen embebida, se omite");
    return { ok: false, warnings };
  }
  const mime = imgMatch[2];
  const b64 = imgMatch[3];
  const ext = MIME_EXT[mime] || "jpg";

  const hrefMatch = body.match(/href="https:\/\/(?:www\.)?activosporcolombia\.com\/es\/[^\/]+\/(\d+)\/[^"]*"/);
  if (!hrefMatch) {
    warnings.push("sin id de ficha (href activosporcolombia), se omite");
    return { ok: false, warnings };
  }
  const siteId = hrefMatch[1];

  const locMatch = body.match(/<div class="loc">([^<]*)<\/div>/);
  const loc = locMatch ? unescapeHtml(locMatch[1].trim()) : "";

  const h3Match = body.match(/<h3>([^<]*)<\/h3>/);
  const nombre = h3Match ? unescapeHtml(h3Match[1].trim()) : "Inmueble";

  const hlMatch = body.match(/<p class="highlight">([^<]*)<\/p>/);
  const highlight = hlMatch ? unescapeHtml(hlMatch[1].trim()) : "";

  const specs = [...body.matchAll(/<span class="spec">([\s\S]*?)<\/span>/g)].map((s) => s[1]);
  let areaResult = { value: 0, ok: false };
  let codigoLabel = null;
  for (const spec of specs) {
    if (!areaResult.ok) {
      const a = parseArea(spec);
      if (a.ok) areaResult = a;
    }
    const fmiM = spec.match(/FMI\s*<b>([^<]+)<\/b>/i);
    const codM = spec.match(/C[oó]digo\s*<b>([^<]+)<\/b>/i);
    if (fmiM) codigoLabel = "FMI " + fmiM[1].trim();
    else if (codM) codigoLabel = "Código " + codM[1].trim();
  }
  if (!areaResult.ok) warnings.push("no se pudo leer el area, quedo en 0");
  if (!codigoLabel) codigoLabel = "ID " + siteId;

  const priceMatch = body.match(/<div class="price">([^<]*)<\/div>/);
  const priceText = priceMatch ? unescapeHtml(priceMatch[1].trim()) : "";
  const priceResult = parsePrice(priceText);
  if (!priceResult.ok) warnings.push('no se pudo leer el precio ("' + priceText + '"), avaluo quedo en 0');

  return {
    ok: true,
    warnings,
    siteId,
    mime,
    b64,
    ext,
    loc,
    nombre,
    highlight,
    codigoLabel,
    area: areaResult.value,
    priceText,
    avaluo: priceResult.value,
  };
}

function buildSubastarHref(item) {
  const params = new URLSearchParams({
    fmi: item.siteId,
    nombre: item.nombre,
    ciudad: item.loc,
    area: String(item.area),
    avaluo: String(item.avaluo),
    imagen: `${SITE_IMAGES_BASE}/${item.siteId}.${item.ext}`,
  });
  return `${HOST_BASE}?${params.toString()}`;
}

const TEMPLATE_HEAD = `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Panel interno · Subastar inmuebles</title>
<link rel="icon" type="image/png" href="../favicon.png">
<link rel="apple-touch-icon" href="../apple-touch-icon.png">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"><\/script>
<style>
  @font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:400;font-display:swap;src:url('../fonts/PlusJakartaSans-400.woff2') format('woff2');}
  @font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:500;font-display:swap;src:url('../fonts/PlusJakartaSans-500.woff2') format('woff2');}
  @font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:600;font-display:swap;src:url('../fonts/PlusJakartaSans-600.woff2') format('woff2');}
  @font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:700;font-display:swap;src:url('../fonts/PlusJakartaSans-700.woff2') format('woff2');}
  @font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:800;font-display:swap;src:url('../fonts/PlusJakartaSans-800.woff2') format('woff2');}
  :root{
    --archivo:#0b2a4a;
    --navy3:#173f70;
    --manila:#eaf1fb;
    --sello:#E03535;
    --esmeralda:#1AB87A;
    --oro:#f5a623;
    --azul:#1aa8dd;
  }
  *{box-sizing:border-box;}
  html, body{ overflow-x:hidden; max-width:100%; }
  body{
    margin:0;
    background:#0a1628;
    color:var(--manila);
    font-family:'Plus Jakarta Sans',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  h1,h2,h3{font-family:'Plus Jakarta Sans',system-ui,sans-serif; margin:0;}
  p{margin:0;}
  a{color:inherit; text-decoration:none;}
  img{max-width:100%; display:block;}
  button{font-family:inherit;}
  a:focus-visible, button:focus-visible, input:focus-visible{
    outline:2px solid var(--azul); outline-offset:2px; border-radius:4px;
  }

  @keyframes fadeSlideDown{ from{opacity:0; transform:translateY(-14px);} to{opacity:1; transform:translateY(0);} }
  @keyframes fadeSlideUp{ from{opacity:0; transform:translateY(22px);} to{opacity:1; transform:translateY(0);} }
  @keyframes pulseBadge{
    0%,100%{ box-shadow:0 0 0 0 rgba(224,53,53,0.45); }
    50%{ box-shadow:0 0 0 7px rgba(224,53,53,0); }
  }
  @keyframes dotBlink{
    0%,100%{ opacity:1; transform:scale(1); }
    50%{ opacity:.45; transform:scale(.8); }
  }
  @keyframes floatBg{
    0%{ background-position:0% 0%; }
    50%{ background-position:100% 100%; }
    100%{ background-position:0% 0%; }
  }

  /* Particulas ascendiendo: puntitos de luz azul/ambar que suben muy
     despacio y se desvanecen, para que el fondo se sienta "vivo" (como
     datos en tiempo real) sin distraer del contenido. */
  #bgParticles{ position:fixed; inset:0; z-index:0; pointer-events:none; overflow:hidden; }

  /* Bordes laterales: una linea de brillo que sube y baja muy despacio en
     cada extremo de la pantalla, para que los margenes vacios en monitores
     anchos no se sientan un espacio muerto. */
  .edge-glow{
    position:fixed; top:0; bottom:0; width:120px; z-index:0; pointer-events:none; overflow:hidden;
  }
  .edge-glow.left{ left:0; background:linear-gradient(90deg, rgba(26,168,221,0.12) 0%, rgba(26,168,221,0) 100%); }
  .edge-glow.right{ right:0; background:linear-gradient(270deg, rgba(245,166,35,0.10) 0%, rgba(245,166,35,0) 100%); }
  .edge-glow::after{
    content:""; position:absolute; left:0; right:0; height:46%;
    background:linear-gradient(180deg, transparent 0%, rgba(234,241,251,0.16) 45%, rgba(234,241,251,0.16) 55%, transparent 100%);
    animation:edgeGlowMove 10s ease-in-out infinite alternate;
  }
  .edge-glow.left::after{ background:linear-gradient(180deg, transparent 0%, rgba(26,168,221,0.35) 45%, rgba(26,168,221,0.35) 55%, transparent 100%); }
  .edge-glow.right::after{ background:linear-gradient(180deg, transparent 0%, rgba(245,166,35,0.30) 45%, rgba(245,166,35,0.30) 55%, transparent 100%); animation-delay:3s; }
  @keyframes edgeGlowMove{
    0%{ transform:translateY(-70%); }
    100%{ transform:translateY(170%); }
  }
  @media (max-width:1100px){ .edge-glow{ display:none; } }
  .bg-particle{
    position:absolute; bottom:-10px; border-radius:999px; opacity:0;
    animation-name:bgParticleRise; animation-timing-function:linear; animation-iteration-count:infinite;
  }
  .bg-particle.azul{ background:var(--azul); box-shadow:0 0 8px 1px rgba(26,168,221,0.6); }
  .bg-particle.oro{ background:var(--oro); box-shadow:0 0 8px 1px rgba(245,166,35,0.55); }
  @keyframes bgParticleRise{
    0%{ transform:translateY(0); opacity:0; }
    10%{ opacity:0.55; }
    90%{ opacity:0.45; }
    100%{ transform:translateY(-100vh); opacity:0; }
  }

  /* Fondo oscuro tipo "plano arquitectonico": navy profundo con una
     cuadricula fina y dos halos de marca (azul/ambar) muy tenues. */
  body{
    background-color:#0a1628;
    background-image:
      linear-gradient(rgba(234,241,251,0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(234,241,251,0.05) 1px, transparent 1px),
      radial-gradient(ellipse 1000px 800px at 0% 0%, rgba(26,168,221,0.16) 0%, rgba(26,168,221,0) 60%),
      radial-gradient(ellipse 1000px 800px at 100% 100%, rgba(245,166,35,0.12) 0%, rgba(245,166,35,0) 60%);
    background-size:42px 42px, 42px 42px, auto, auto;
    background-repeat:repeat, repeat, no-repeat, no-repeat;
    background-attachment:fixed;
  }

  /* --- pantalla de login (misma tarjeta de dos tonos que el login del jugador) --- */
  .login-screen{
    position:fixed; inset:0; z-index:100;
    display:flex; align-items:center; justify-content:center;
    background:#081d33; padding:24px;
  }
  .login-card{
    width:100%; max-width:380px;
    border-radius:18px;
    overflow:hidden;
    box-shadow:0 25px 60px -15px rgba(0,0,0,0.5);
    animation: fadeSlideUp .5s cubic-bezier(.22,1,.36,1) both;
  }
  .login-banner{
    padding:34px 28px 26px;
    background:linear-gradient(100deg, #7a4a12 0%, #173f70 46%, #0d3a63 100%);
  }
  .login-banner .brand{ margin-bottom:16px; }
  .login-banner h2{ font-size:21px; font-weight:800; color:var(--manila); margin-bottom:6px; }
  .login-banner p.sub{ color:rgba(234,241,251,0.75); font-size:13px; line-height:1.5; }
  .login-body{
    background:var(--manila);
    padding:26px 28px 28px;
  }
  .login-field{ margin-bottom:14px; }
  .login-field label{ display:block; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:rgba(11,42,74,0.5); margin-bottom:6px; }
  .login-field .input-wrap{ position:relative; }
  .login-field .input-wrap svg{ position:absolute; left:12px; top:50%; transform:translateY(-50%); opacity:.4; pointer-events:none; }
  .login-field input{
    width:100%; padding:11px 14px 11px 36px; border-radius:10px;
    background:#fff; border:1.5px solid rgba(11,42,74,0.12);
    color:var(--archivo); font-family:inherit; font-size:14px;
    transition: border-color .2s ease, box-shadow .2s ease;
  }
  .login-field input::placeholder{ color:rgba(11,42,74,0.32); }
  .login-field input:focus{ outline:none; border-color:var(--azul); box-shadow:0 0 0 3px rgba(26,168,221,0.2); }
  .login-submit{
    width:100%; padding:12px; border-radius:10px; border:none; cursor:pointer;
    font-size:14px; font-weight:700;
    background:linear-gradient(90deg, var(--azul) 0%, var(--navy3) 100%);
    color:var(--manila);
    box-shadow:0 10px 20px -8px rgba(26,168,221,0.4);
    transition: filter .2s ease, transform .15s ease;
    margin-top:4px;
  }
  .login-submit:hover{ filter:brightness(1.08); transform:scale(1.02); }
  .login-submit:active{ transform: scale(.98); }
  .login-submit:disabled{ opacity:.6; cursor:default; filter:none; transform:none; }
  .login-error{
    margin-top:14px; padding:10px 12px; border-radius:8px;
    background:rgba(224,53,53,0.1); border:1px solid rgba(224,53,53,0.35);
    color:#b23a3a; font-size:12.5px; line-height:1.5; display:none;
  }
  .login-footer{
    margin-top:20px; display:flex; align-items:center; justify-content:center; gap:6px;
    color:rgba(11,42,74,0.4); font-size:11px;
  }
  .login-footer .dot{ width:6px; height:6px; border-radius:999px; background:var(--esmeralda); flex-shrink:0; }
  #app-content{ display:none; }

  .topbar{
    position:sticky; top:0; z-index:10;
    display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px 16px;
    padding:14px 20px;
    background:rgba(11,42,74,0.85);
    backdrop-filter: blur(8px);
    border-bottom:1px solid rgba(234,241,251,0.10);
    animation: fadeSlideDown .5s cubic-bezier(.22,1,.36,1) both;
  }
  .brand{display:flex; align-items:center; gap:10px; font-weight:700; letter-spacing:0.02em; color:var(--manila);}
  .brand .dot{width:8px; height:8px; border-radius:999px; background:var(--esmeralda); animation:dotBlink 1.8s ease-in-out infinite;}
  .brand-logo{width:28px; height:28px; border-radius:8px; object-fit:cover; flex-shrink:0;}
  .login-banner .brand-logo{width:40px; height:40px; border-radius:10px;}
  .topbar-right{display:flex; align-items:center; gap:10px; flex-wrap:wrap;}
  .badge-interno{
    font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;
    padding:4px 10px; border-radius:999px; white-space:nowrap;
    background:rgba(224,53,53,0.15); color:#ff9d9d; border:1px solid rgba(224,53,53,0.4);
    animation: pulseBadge 2.6s ease-in-out infinite;
  }
  .logout-btn{
    display:flex; align-items:center; gap:6px;
    font-size:12px; font-weight:600; white-space:nowrap;
    min-height:44px; padding:10px 16px; border-radius:8px;
    background:rgba(234,241,251,0.08); border:1px solid rgba(234,241,251,0.18);
    color:var(--manila); cursor:pointer;
    transition: background .2s ease, transform .2s ease, border-color .2s ease;
  }
  .logout-btn:hover{ background:rgba(224,53,53,0.16); border-color:rgba(224,53,53,0.4); transform:translateY(-1px); }
  .logout-btn svg{width:14px; height:14px;}
  @media (max-width:480px){
    .badge-interno{ font-size:9.5px; letter-spacing:0.02em; padding:3px 8px; }
    .hero-row, .grid{ padding-left:16px; padding-right:16px; }
  }

  @property --angle{ syntax:'<angle>'; initial-value:0deg; inherits:false; }
  @keyframes tileBorderSweep{ to{ --angle:360deg; } }
  @keyframes glowSweep{ 0%{background-position:-200% 0;} 100%{background-position:200% 0;} }

  .hero-row{
    display:flex; align-items:flex-end; justify-content:space-between; flex-wrap:wrap;
    gap:20px 24px; max-width:1200px; margin:0 auto; padding:40px 24px 28px;
  }
  .hero{ padding:0; max-width:520px; min-width:260px; flex:1 1 320px; }
  .hero .eyebrow{
    color:var(--oro); font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.16em; margin-bottom:8px;
    animation: fadeSlideUp .55s cubic-bezier(.22,1,.36,1) .08s both;
  }
  .hero h1{
    font-size:clamp(24px,3vw,34px); font-weight:800; margin-bottom:8px;
    animation: fadeSlideUp .55s cubic-bezier(.22,1,.36,1) .16s both;
  }
  .hero p{
    color:rgba(234,241,251,0.65); font-size:14px; max-width:640px; line-height:1.6;
    animation: fadeSlideUp .55s cubic-bezier(.22,1,.36,1) .24s both;
  }

  /* --- Contador de la proxima ronda de subasta: version compacta, al lado
     del titulo (antes era un banner de ancho completo debajo del hero). --- */
  .countdown-banner{
    position:relative; overflow:hidden; flex-shrink:0;
    border-radius:16px;
    background:
      radial-gradient(ellipse 300px 180px at 10% 0%, rgba(245,166,35,0.16) 0%, rgba(245,166,35,0) 60%),
      radial-gradient(ellipse 300px 200px at 100% 100%, rgba(26,168,221,0.18) 0%, rgba(26,168,221,0) 60%),
      linear-gradient(160deg, #123457 0%, #0b2a4a 55%, #0a2543 100%);
    padding:18px 22px;
    display:flex; align-items:center; gap:16px;
    animation: fadeSlideUp .55s cubic-bezier(.22,1,.36,1) both;
  }
  .countdown-banner::before{
    content:""; position:absolute; top:0; left:0; right:0; height:7px;
    background:linear-gradient(90deg, transparent, var(--azul), var(--oro), transparent);
    background-size:200% 100%;
    animation: glowSweep 2.6s ease-in-out infinite;
    box-shadow:0 0 8px 1px rgba(26,168,221,0.4);
  }
  .countdown-date{
    position:relative; z-index:1; display:flex; align-items:center; gap:8px; color:var(--sello);
    font-size:12.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; white-space:nowrap;
    padding-right:16px; border-right:1px solid rgba(234,241,251,0.14);
  }
  .countdown-dot{ width:7px; height:7px; border-radius:999px; background:var(--sello); flex-shrink:0; animation:dotBlink 1.6s ease-in-out infinite; }
  .countdown-clock{ position:relative; z-index:1; display:flex; align-items:center; gap:10px; }
  .countdown-box{
    background:rgba(234,241,251,0.07); border:1px solid rgba(234,241,251,0.13);
    border-radius:10px; padding:9px 14px; text-align:center; min-width:50px;
  }
  .countdown-num{ display:block; font-size:23px; font-weight:800; font-variant-numeric:tabular-nums; color:var(--manila); }
  .countdown-label{ display:block; font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:rgba(234,241,251,0.6); margin-top:4px; }
  .countdown-sep{ font-size:19px; font-weight:800; color:rgba(234,241,251,0.22); }
  @media (max-width:760px){
    .hero-row{ align-items:flex-start; flex-wrap:wrap; }
    .countdown-banner{ width:100%; flex-wrap:wrap; }
    .countdown-date{ border-right:none; padding-right:0; margin-bottom:4px; flex-basis:100%; }
    .countdown-clock{ justify-content:space-between; width:100%; }
  }
  @media (max-width:480px){
    .countdown-box{ min-width:0; flex:1; padding:8px 6px; }
  }

  .grid{
    max-width:1200px; margin:0 auto; padding:24px 24px 64px;
    display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:20px;
  }
  .tile{
    position:relative; aspect-ratio:3/4; border-radius:16px; overflow:hidden;
    box-shadow:0 10px 26px -12px rgba(0,0,0,.5);
    background:#0a2543;
    animation: fadeSlideUp .6s cubic-bezier(.22,1,.36,1) both;
    transition: transform .3s cubic-bezier(.22,1,.36,1), box-shadow .3s ease;
    will-change: transform;
  }
  /* Borde que brilla breve y en movimiento (un arco que da la vuelta),
     no un glow fuerte/constante. */
  /* Brillo del borde: elemento real (span, ultimo hijo), no ::before --
     en Chromium un <img> hermano con object-fit puede pintarse encima de
     un pseudo-elemento con mask aunque su z-index sea mayor (bug de
     compositing visto en pruebas); un elemento real al final del DOM con
     z-index alto sí respeta el orden esperado. */
  .tile-glow{
    content:""; position:absolute; inset:0; border-radius:16px; padding:9px;
    background: conic-gradient(from var(--angle), transparent 0deg, transparent 225deg, rgba(26,168,221,1) 280deg, rgba(245,166,35,1) 320deg, transparent 355deg);
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude;
    animation: tileBorderSweep 6s linear infinite; animation-delay: var(--glow-delay, 0ms);
    pointer-events:none; z-index:5; display:block;
    filter: drop-shadow(0 0 4px rgba(26,168,221,0.55));
  }
  .tile:hover{
    transform: translateY(-8px) scale(1.015);
    box-shadow:0 22px 40px -14px rgba(0,0,0,.65);
  }
  .tile img{
    width:100%; height:100%; object-fit:cover; position:absolute; inset:0;
    transition: transform .5s cubic-bezier(.22,1,.36,1), filter .4s ease;
  }
  .tile:hover img{ transform: scale(1.09); filter:brightness(1.04) saturate(1.08); }
  .scrim{
    position:absolute; inset:0;
    background:linear-gradient(180deg, rgba(8,29,51,0) 35%, rgba(8,29,51,.92) 100%);
    transition: background .3s ease;
  }
  .tile:hover .scrim{ background:linear-gradient(180deg, rgba(8,29,51,0.05) 25%, rgba(8,29,51,.96) 100%); }
  .fmi-badge{
    position:absolute; top:10px; left:10px; z-index:2;
    font-family:'Courier New',monospace; font-size:11px;
    background:rgba(11,42,74,0.85); color:var(--oro);
    padding:3px 9px; border-radius:999px; border:1px solid rgba(245,166,35,0.4);
    transition: transform .3s cubic-bezier(.22,1,.36,1);
  }
  .tile:hover .fmi-badge{ transform: translateY(-2px); }
  .info{
    position:absolute; left:0; right:0; bottom:0; padding:16px; z-index:2;
    transition: transform .3s cubic-bezier(.22,1,.36,1);
  }
  .tile:hover .info{ transform: translateY(-3px); }
  .loc{font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--azul); margin-bottom:3px;}
  .nombre{font-weight:700; font-size:15.5px; margin-bottom:2px; color:var(--manila);}
  .highlight{font-size:12px; color:rgba(234,241,251,0.78); margin-bottom:8px; min-height:15px;}
  .row-bottom{display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;}
  .price-block{ display:flex; flex-direction:column; }
  .price-label{ font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:rgba(234,241,251,0.65); margin-bottom:1px; }
  .price{
    font-weight:800; color:var(--oro); font-size:15px;
    transition: text-shadow .3s ease;
  }
  .tile:hover .price{ text-shadow:0 0 14px rgba(245,166,35,0.55); }
  .cta{
    display:flex; align-items:center; gap:6px;
    min-height:44px; padding:12px 18px; border-radius:8px; font-size:13px; font-weight:700;
    font-family:inherit; cursor:pointer;
    background:linear-gradient(90deg, var(--azul) 0%, var(--navy3) 100%);
    background-size:160% 100%;
    color:var(--manila);
    box-shadow:0 6px 16px rgba(26,168,221,0.28);
    transition: filter .25s ease, box-shadow .25s ease, transform .25s cubic-bezier(.22,1,.36,1), background-position .5s ease;
  }
  .tile:hover .cta{
    filter:brightness(1.1);
    box-shadow:0 10px 22px rgba(26,168,221,0.4);
    background-position:100% 0;
    transform: translateX(2px);
  }
  .cta:active{ transform: scale(.96); }
  .cta svg{width:14px; height:14px; transition: transform .3s cubic-bezier(.22,1,.36,1);}
  .tile:hover .cta svg{ transform: translateX(4px); }

  footer{
    padding:24px; text-align:center; font-size:12px; color:rgba(234,241,251,0.6);
    border-top:1px solid rgba(234,241,251,0.10);
    animation: fadeSlideUp .5s ease both;
  }

  /* --- layout de dos columnas: tarjetas + panel de estadisticas en vivo --- */
  .layout-wrap{
    width:96%; max-width:1680px; margin:0 auto; padding:0 32px;
    display:grid; grid-template-columns:1fr; align-items:start;
  }
  .main-col{ min-width:0; }
  .main-col .hero-row{ padding:0 0 28px; max-width:none; }
  .main-col .grid{ max-width:none; padding:0 0 40px; }
  @media (max-width:980px){
    .layout-wrap{ grid-template-columns:1fr; padding:0 20px; }
  }

  .stats-sidebar{
    display:flex; flex-direction:column; gap:16px;
    position:sticky; top:78px;
    animation: fadeSlideUp .55s cubic-bezier(.22,1,.36,1) .1s both;
  }
  @media (max-width:980px){ .stats-sidebar{ position:static; margin-bottom:8px; } }

  .stat-card{
    position:relative; overflow:hidden;
    background:rgba(234,241,251,0.045); border:1px solid rgba(234,241,251,0.10);
    border-radius:14px; padding:18px 18px 16px; backdrop-filter:blur(6px);
    box-shadow:0 14px 28px -20px rgba(0,0,0,0.55);
  }
  .stat-card::before{
    content:""; position:absolute; left:0; top:0; bottom:0; width:3px;
    background:linear-gradient(180deg, var(--azul), var(--oro));
    opacity:0.75;
  }
  .stat-card-head{ display:flex; align-items:center; gap:9px; margin-bottom:2px; }
  .stat-card-head .stat-title{ flex:1; }
  .stat-icon{
    width:26px; height:26px; border-radius:8px; flex-shrink:0;
    display:flex; align-items:center; justify-content:center;
    background:rgba(26,168,221,0.14); color:var(--azul);
  }
  .stat-icon svg{ width:14px; height:14px; }
  .stat-card--activity::before{ background:var(--azul); }
  .stat-card--activity .stat-icon{ background:rgba(26,168,221,0.14); color:var(--azul); }
  .stat-card--players::before{ background:var(--oro); }
  .stat-card--players .stat-icon{ background:rgba(245,166,35,0.16); color:var(--oro); }
  .stat-card--auctions::before{ background:var(--esmeralda); }
  .stat-card--auctions .stat-icon{ background:rgba(26,184,122,0.16); color:var(--esmeralda); }
  .stat-dot{
    width:7px; height:7px; border-radius:999px; background:rgba(234,241,251,0.25); flex-shrink:0;
    transition: background .3s ease, box-shadow .3s ease;
  }
  .stat-dot.is-live{ background:var(--esmeralda); box-shadow:0 0 0 3px rgba(26,184,122,0.22); animation:dotBlink 1.8s ease-in-out infinite; }
  .stat-title{
    font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em;
    color:rgba(234,241,251,0.55); margin-bottom:10px;
  }
  .stat-card-head .stat-title{ margin-bottom:0; }
  .stat-big{ font-size:34px; font-weight:800; color:var(--manila); font-variant-numeric:tabular-nums; margin:6px 0 2px; letter-spacing:-0.01em; }
  .stat-sub{ font-size:12px; color:rgba(234,241,251,0.6); line-height:1.5; }

  .stat-list{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:9px; }
  .stat-list li{
    display:flex; align-items:baseline; justify-content:space-between; gap:10px;
    font-size:12.5px; padding-bottom:9px; border-bottom:1px dashed rgba(234,241,251,0.10);
  }
  .stat-list li:last-child{ border-bottom:none; padding-bottom:0; }
  .stat-list .nm{ color:var(--manila); font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .stat-list .meta{ color:rgba(234,241,251,0.58); font-size:10.5px; white-space:nowrap; }
  .stat-list .val{ color:var(--oro); font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .stat-empty{ color:rgba(234,241,251,0.55); font-size:12.5px; font-style:italic; }
  .stat-footnote{
    margin-top:10px; padding-top:10px; border-top:1px solid rgba(234,241,251,0.08);
    font-size:11px; color:rgba(234,241,251,0.6);
  }
  .stat-footnote b{ color:var(--oro); font-weight:700; }

  /* Skeleton de carga inicial: se ve mientras llega la primera respuesta del
     servidor -- reemplaza el texto "Cargando..." estatico por barras animadas,
     mas honesto visualmente y respeta prefers-reduced-motion (regla global). */
  .skeleton-line{
    height:10px; border-radius:5px; margin:7px 0;
    background:linear-gradient(90deg, rgba(234,241,251,0.06) 25%, rgba(234,241,251,0.16) 37%, rgba(234,241,251,0.06) 63%);
    background-size:400% 100%;
    animation: shimmer 1.6s ease-in-out infinite;
  }
  .skeleton-line:last-child{ width:65%; }
  @keyframes shimmer{ 0%{ background-position:100% 0; } 100%{ background-position:-100% 0; } }

  .stat-status{ display:flex; align-items:flex-start; gap:8px; }
  .stat-status svg{ width:14px; height:14px; flex-shrink:0; margin-top:1px; color:#ff9d9d; }
  .stat-status p{ font-size:12px; color:rgba(234,241,251,0.65); line-height:1.5; }

  @media (prefers-reduced-motion: reduce){
    *, *::before, *::after{
      animation-duration:0.001ms !important;
      animation-iteration-count:1 !important;
      transition-duration:0.001ms !important;
      scroll-behavior:auto !important;
    }
  }
</style>
</head>
<body>

  <div id="bgParticles" aria-hidden="true"></div>
  <div class="edge-glow left" aria-hidden="true"></div>
  <div class="edge-glow right" aria-hidden="true"></div>

  <div id="login-screen" class="login-screen">
    <div class="login-card">
      <div class="login-banner">
        <div class="brand"><img src="../logo.png" alt="Activos por Colombia" class="brand-logo">Subasta Activa</div>
        <h2>Acceso al panel interno</h2>
        <p class="sub">Ingresa con tu correo de Activos por Colombia para entrar al catálogo de subasta.</p>
      </div>
      <div class="login-body">
        <form id="loginForm">
          <div class="login-field">
            <label for="loginEmail">Correo</label>
            <div class="input-wrap">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/></svg>
              <input type="email" id="loginEmail" autocomplete="username" required placeholder="tucorreo@activosporcolombia.com" />
            </div>
          </div>
          <div class="login-field">
            <label for="loginPassword">Contraseña</label>
            <div class="input-wrap">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
              <input type="password" id="loginPassword" autocomplete="current-password" required placeholder="••••••••" />
            </div>
          </div>
          <button type="submit" class="login-submit" id="loginSubmitBtn">Entrar</button>
          <div class="login-error" id="loginError"></div>
        </form>
        <div class="login-footer"><span class="dot"></span>Activos por Colombia S.A.S.</div>
      </div>
    </div>
  </div>

  <div id="app-content">

  <div class="topbar">
    <div class="brand"><img src="../logo.png" alt="Activos por Colombia" class="brand-logo">Subasta Activa</div>
    <div class="topbar-right">
      <span class="badge-interno">Panel interno · No compartir con clientes</span>
      <button type="button" class="logout-btn" id="logoutBtn" title="Cerrar sesión">
        Cerrar sesión
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
      </button>
    </div>
  </div>

  <div class="layout-wrap">
  <div class="main-col">

  <div class="hero-row">
    <div class="hero">
      <p class="eyebrow">Equipo · Activos por Colombia</p>
      <h1>Arrancar una subasta</h1>
      <p>Elige el inmueble y toca "Subastar" para armarlo en la consola del presentador. Esta vista es solo para el equipo -- los clientes ven el portafolio público, sin este botón.</p>
    </div>
<!-- COUNTDOWN_BANNER -->
  </div>

  <div class="grid">
`;

const TEMPLATE_TAIL = `  </div>

  </div>

  <footer>Activos por Colombia S.A.S. · Panel interno de subasta</footer>

  </div>

  <script>
    (function () {
      // Fondo "vivo": puntitos de luz azul/ambar que suben despacio y se
      // desvanecen. Corre independiente del login (para que se vea incluso
      // en la pantalla de acceso) y respeta prefers-reduced-motion via la
      // regla global de animaciones.
      var bgHost = document.getElementById("bgParticles");
      if (bgHost) {
        var totalParticulas = 26;
        for (var i = 0; i < totalParticulas; i++) {
          var p = document.createElement("div");
          var esAzul = i % 2 === 0;
          p.className = "bg-particle " + (esAzul ? "azul" : "oro");
          var tam = 2 + Math.random() * 3;
          p.style.width = tam + "px";
          p.style.height = tam + "px";
          // La mayoria nace pegada a los bordes izquierdo/derecho (donde
          // antes se veia vacio en monitores anchos); solo unas pocas se
          // reparten por el resto de la pantalla para no tapar el contenido.
          var pos;
          var r = Math.random();
          if (r < 0.42) pos = Math.random() * 13;
          else if (r < 0.84) pos = 87 + Math.random() * 13;
          else pos = 13 + Math.random() * 74;
          p.style.left = pos + "%";
          p.style.animationDuration = (9 + Math.random() * 7) + "s";
          p.style.animationDelay = (Math.random() * 12) + "s";
          bgHost.appendChild(p);
        }
      }
    })();

    (function () {
      var SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};
      var SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};

      var loginScreen = document.getElementById("login-screen");
      var appContent = document.getElementById("app-content");
      var loginForm = document.getElementById("loginForm");
      var loginError = document.getElementById("loginError");
      var loginSubmitBtn = document.getElementById("loginSubmitBtn");
      var logoutBtn = document.getElementById("logoutBtn");

      function showApp() {
        loginScreen.style.display = "none";
        appContent.style.display = "block";
      }
      function showLogin() {
        appContent.style.display = "none";
        loginScreen.style.display = "flex";
      }

      // Si el script de Supabase (CDN externo) no llega a cargar -- red lenta,
      // bloqueador, CDN caido -- no debe tumbar el resto de la pagina (el
      // contador y el panel de estadisticas de abajo deben seguir andando).
      var sb = null;
      try {
        if (window.supabase && window.supabase.createClient) {
          sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }
      } catch (e) {
        sb = null;
      }

      if (!sb) {
        if (loginError) {
          loginError.textContent = "No se pudo cargar el inicio de sesión (revisa tu conexión y recarga la página).";
          loginError.style.display = "block";
        }
        if (loginSubmitBtn) loginSubmitBtn.disabled = true;
        showLogin();
      } else {
        sb.auth.getSession().then(function (res) {
          if (res.data && res.data.session) showApp();
          else showLogin();
        });

        loginForm.addEventListener("submit", function (e) {
          e.preventDefault();
          loginError.style.display = "none";
          loginSubmitBtn.disabled = true;
          loginSubmitBtn.textContent = "Entrando...";
          var email = document.getElementById("loginEmail").value.trim();
          var password = document.getElementById("loginPassword").value;
          sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
            loginSubmitBtn.disabled = false;
            loginSubmitBtn.textContent = "Entrar";
            if (res.error) {
              loginError.textContent = "No pudimos verificar esos datos: " + res.error.message;
              loginError.style.display = "block";
              return;
            }
            showApp();
          });
        });
      }

      if (logoutBtn) {
        logoutBtn.addEventListener("click", function () {
          if (!sb) { showLogin(); return; }
          sb.auth.signOut().then(function () {
            showLogin();
          });
        });
      }

      function pad2(n) { return n < 10 ? "0" + n : "" + n; }
      var clockEl = document.querySelector(".countdown-clock");
      if (clockEl) {
        var target = new Date(clockEl.getAttribute("data-target")).getTime();
        var dEl = clockEl.querySelector('[data-unit="dias"]');
        var hEl = clockEl.querySelector('[data-unit="hrs"]');
        var mEl = clockEl.querySelector('[data-unit="min"]');
        var sEl = clockEl.querySelector('[data-unit="seg"]');
        var tick = function () {
          var diff = Math.max(0, target - Date.now());
          var segTotal = Math.floor(diff / 1000);
          var dias = Math.floor(segTotal / 86400);
          var hrs = Math.floor((segTotal % 86400) / 3600);
          var min = Math.floor((segTotal % 3600) / 60);
          var seg = segTotal % 60;
          dEl.textContent = pad2(dias);
          hEl.textContent = pad2(hrs);
          mEl.textContent = pad2(min);
          sEl.textContent = pad2(seg);
        };
        tick();
        setInterval(tick, 1000);
      }

    })();
  </script>

</body>
</html>
`;

function tileHtml(item, index) {
  const col = index % 4;
  const row = Math.floor(index / 4);
  const delay = Math.min(col * 70 + row * 25, 480);
  const glowDelay = -((index % 6) * 1250);
  const href = escapeHtml(buildSubastarHref(item));
  const img = `../images/${item.siteId}.${item.ext}`;
  return `      <a class="tile" href="${href}" style="animation-delay:${delay}ms; --glow-delay:${glowDelay}ms">
        <img src="${escapeHtml(img)}" alt="${escapeHtml(item.nombre)}" loading="lazy" />
        <div class="scrim"></div>
        <span class="fmi-badge">${escapeHtml(item.codigoLabel)}</span>
        <div class="info">
          <div class="loc">${escapeHtml(item.loc)}</div>
          <div class="nombre">${escapeHtml(item.nombre)}</div>
          <div class="highlight">${escapeHtml(item.highlight)}</div>
          <div class="row-bottom">
            <div class="price-block">
              <span class="price-label">Subasta desde</span>
              <span class="price">${escapeHtml(item.priceText)}</span>
            </div>
            <span class="cta">Subastar
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </span>
          </div>
        </div>
        <span class="tile-glow" aria-hidden="true"></span>
      </a>
`;
}

function main() {
  const html = readSource();
  const cardBodies = extractCards(html);
  console.log(`Tarjetas encontradas en index.html: ${cardBodies.length}`);

  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const items = [];
  let skipped = 0;
  cardBodies.forEach((body, i) => {
    const parsed = parseCard(body, i);
    if (!parsed.ok) {
      skipped++;
      console.warn(`  [OMITIDA #${i + 1}] ${parsed.warnings.join("; ")}`);
      return;
    }
    if (parsed.warnings.length) {
      console.warn(`  [AVISO ${parsed.nombre} / ${parsed.loc}] ${parsed.warnings.join("; ")}`);
    }
    const imgPath = path.join(IMAGES_DIR, `${parsed.siteId}.${parsed.ext}`);
    fs.writeFileSync(imgPath, Buffer.from(parsed.b64, "base64"));
    items.push(parsed);
  });

  const tiles = items.map((item, i) => tileHtml(item, i)).join("");
  const head = TEMPLATE_HEAD.replace("<!-- COUNTDOWN_BANNER -->", countdownBannerHtml(items[0] || null));
  const out = head + tiles + TEMPLATE_TAIL;
  fs.writeFileSync(OUT_HTML, out, "utf-8");

  console.log(`\nListo: ${items.length} inmuebles escritos en admin/index.html (${skipped} omitidas).`);
  console.log(`Fotos guardadas/actualizadas en images/.`);
  console.log(`\nAhora sube los cambios con git (add admin/index.html, images/*, y commit + push).`);
}

main();
