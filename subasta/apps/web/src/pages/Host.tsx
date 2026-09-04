import { useCallback, useEffect, useRef, useState } from "react";
import type { Property, PropertyInput } from "@subasta/shared";
import { useSocket } from "../lib/useSocket.js";
import { wsUrl } from "../lib/wsUrl.js";
import { supabase } from "../lib/supabaseClient.js";
import { useFlip } from "../lib/useFlip.js";
import BrandMark from "../components/BrandMark.js";

const WS_URL = wsUrl("/ws/host");

type HostState = {
  estado: string;
  pin: string;
  properties: Property[];
  jugadores: {
    playerId: string;
    nickname: string;
    telefono?: string;
    correo?: string;
    conectado?: boolean;
    flagged: boolean;
  }[];
  rondaActual: {
    roundId: string;
    propiedad: Property;
    estado: string;
    ganador: { playerId: string; nickname: string; valorFinal: number } | null;
  } | null;
  historial: {
    roundId: string;
    propiedad: { nombre: string; matriculaInmobiliaria: string; ciudad?: string };
    ganador: { playerId: string; nickname: string; valorFinal: number } | null;
    abortada: boolean;
    finalizadaEn: number;
  }[];
};

type LiveTick = {
  roundId: string;
  remainingMs: number;
  top: { playerId: string; nickname: string; taps: number; valorPujado: number; flagged: boolean }[];
  tapsTotales: number;
  valorActual: number;
};

// Version compacta del valor pujado (ej. "171.5M" en vez de "171.500.000"),
// para que quepa en las columnas angostas del ranking de la ronda sin
// pegarse con el jugador de al lado.
function formatoCompacto(valor: number): string {
  if (valor >= 1_000_000) {
    const millones = valor / 1_000_000;
    return `${millones.toFixed(millones < 10 ? 1 : 0).replace(/\.0$/, "")}M`;
  }
  if (valor >= 1_000) {
    return `${Math.round(valor / 1_000)}K`;
  }
  return valor.toString();
}

// Deriva un "tipo" corto para el inmueble a partir de su nombre, cuando llega
// autocreado desde el portafolio (que no maneja esa categoria por separado).
function tipoDesdeNombre(nombre: string): string {
  const n = nombre.toLowerCase();
  const categorias = [
    "apartamento",
    "casa",
    "lote",
    "edificio",
    "parqueadero",
    "hotel",
    "local",
    "finca",
    "bodega",
  ];
  const encontrada = categorias.find((c) => n.includes(c));
  return encontrada ? encontrada.charAt(0).toUpperCase() + encontrada.slice(1) : "Inmueble";
}

const EMPTY_FORM: PropertyInput = {
  nombre: "",
  ciudad: "",
  tipo: "",
  matriculaInmobiliaria: "",
  areaM2: 0,
  avaluo: 0,
  descripcion: "",
  imagenUrl: "",
};

export default function Host() {
  // --- Login (Supabase Auth email+contraseña, con fallback a token fijo si Supabase no está configurado) ---
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [devToken, setDevToken] = useState("dev-host-token");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

  const [state, setState] = useState<HostState | null>(null);
  const [liveTick, setLiveTick] = useState<LiveTick | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showJugadores, setShowJugadores] = useState(false);

  // --- Formulario de propiedades (crear / editar) ---
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PropertyInput>(EMPTY_FORM);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // --- Crear nuevos administradores ---
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [nuevoAdminEmail, setNuevoAdminEmail] = useState("");
  const [nuevoAdminPassword, setNuevoAdminPassword] = useState("");
  const [adminMsg, setAdminMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [creandoAdmin, setCreandoAdmin] = useState(false);

  const onMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    if (msg.t === "host:state") {
      setState(msg as unknown as HostState);
      if (!(msg as unknown as HostState).rondaActual) setLiveTick(null);
    }
    if (msg.t === "host:tick") setLiveTick(msg as unknown as LiveTick);
    if (msg.t === "host:admin_created") {
      setCreandoAdmin(false);
      setAdminMsg({ tipo: "ok", texto: `Administrador creado: ${msg.email}` });
      setNuevoAdminEmail("");
      setNuevoAdminPassword("");
    }
    if (msg.t === "error") {
      setCreandoAdmin(false);
      if (msg.code === "admin_create_failed") {
        setAdminMsg({ tipo: "error", texto: String(msg.mensaje ?? "No se pudo crear el administrador") });
      } else {
        setActionError(String(msg.mensaje ?? "Ocurrió un error"));
      }
    }
  }, []);

  const { send, connected } = useSocket(WS_URL, onMessage);
  const rankingFlipRef = useFlip(liveTick?.top.map((p) => p.playerId) ?? []);

  const joinWithToken = useCallback(
    (t: string) => {
      send({ t: "host:join", token: t });
      setAuthed(true);
    },
    [send]
  );

  // Si ya hay una sesión de Supabase activa (recarga de página), reusarla.
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        setAccessToken(data.session.access_token);
      }
    });
  }, []);

  useEffect(() => {
    if (accessToken && connected && !authed) {
      joinWithToken(accessToken);
    }
  }, [accessToken, connected, authed, joinWithToken]);

  const loginConSupabase = async () => {
    if (!supabase) return;
    setLoggingIn(true);
    setLoginError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoggingIn(false);
    if (error || !data.session) {
      setLoginError(error?.message ?? "No se pudo iniciar sesión");
      return;
    }
    setAccessToken(data.session.access_token);
  };

  const loginConToken = () => {
    joinWithToken(devToken);
  };

  const logout = async () => {
    if (supabase) await supabase.auth.signOut();
    setAuthed(false);
    setAccessToken(null);
    setState(null);
  };

  const openCreateForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setUploadError(null);
    setShowForm(true);
  };

  const openEditForm = (p: Property) => {
    setEditingId(p.id);
    setForm({
      nombre: p.nombre,
      ciudad: p.ciudad,
      tipo: p.tipo,
      matriculaInmobiliaria: p.matriculaInmobiliaria,
      areaM2: p.areaM2,
      avaluo: p.avaluo,
      descripcion: p.descripcion ?? "",
      imagenUrl: p.imagenUrl ?? "",
    });
    setUploadError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setUploadError(null);
  };

  const subirImagen = async (file: File) => {
    if (!supabase) return;
    setUploadError(null);
    if (!file.type.startsWith("image/")) {
      setUploadError("El archivo debe ser una imagen.");
      return;
    }
    const MAX_BYTES = 8 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      setUploadError("La imagen no puede pesar más de 8 MB.");
      return;
    }
    setUploadingImage(true);
    try {
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("inmuebles").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("inmuebles").getPublicUrl(path);
      setForm((f) => ({ ...f, imagenUrl: data.publicUrl }));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "No se pudo subir la imagen.");
    } finally {
      setUploadingImage(false);
    }
  };

  const submitForm = () => {
    setActionError(null);
    const data: PropertyInput = {
      ...form,
      areaM2: Number(form.areaM2),
      avaluo: Number(form.avaluo),
      descripcion: form.descripcion || undefined,
      imagenUrl: form.imagenUrl || undefined,
    };
    if (editingId) {
      send({ t: "host:update_property", propertyId: editingId, data });
    } else {
      send({ t: "host:create_property", data });
    }
    closeForm();
  };

  const eliminarPropiedad = (id: string) => {
    send({ t: "host:delete_property", propertyId: id });
  };

  const volverAPonerEnSubasta = (id: string) => {
    send({ t: "host:relist_property", propertyId: id });
  };

  const reiniciarJugadores = () => {
    send({ t: "host:reset_players" });
  };

  const crearAdmin = () => {
    setAdminMsg(null);
    setCreandoAdmin(true);
    send({ t: "host:create_admin", email: nuevoAdminEmail, password: nuevoAdminPassword });
  };

  const passwordValida = nuevoAdminPassword.length >= 6;
  const emailAdminValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevoAdminEmail);

  // ---------- Pantalla de login ----------
  // --- Detecta el inmueble elegido desde el botón "Subastar" del portafolio
  // público (?fmi=<matricula>&nombre=..&ciudad=..&area=..&avaluo=..). No arma
  // la ronda solo: el presentador debe confirmar con el botón "Subastar para
  // comenzar", así da tiempo a que los jugadores se registren con el QR de
  // "Abrir pantalla proyector" antes de que arranque la ronda.
  //
  // El portafolio es la fuente de verdad de los inmuebles: si el que llega
  // por FMI todavía no existe en el juego, se crea solo (una sola vez) con
  // los datos que trae la URL, sin que nadie tenga que cargarlo a mano.
  const [datosFmi] = useState<{
    fmi: string;
    nombre: string;
    ciudad: string;
    areaM2: number;
    avaluo: number;
    imagenUrl: string | null;
  } | null>(() => {
    const qs = new URLSearchParams(window.location.search);
    const fmi = qs.get("fmi");
    const nombre = qs.get("nombre");
    const ciudad = qs.get("ciudad");
    const areaM2 = Number(qs.get("area"));
    const avaluo = Number(qs.get("avaluo"));
    const imagenUrl = qs.get("imagen");
    if (!fmi || !nombre || !ciudad || !Number.isFinite(areaM2) || !Number.isFinite(avaluo)) {
      return null;
    }
    return { fmi, nombre, ciudad, areaM2, avaluo, imagenUrl };
  });
  const fmiParam = datosFmi?.fmi ?? null;
  const [intentoCreacion, setIntentoCreacion] = useState(false);

  useEffect(() => {
    if (!authed || !state || !datosFmi || intentoCreacion) return;
    const yaExiste = state.properties.some((p) => p.matriculaInmobiliaria === datosFmi.fmi);
    if (yaExiste) return;
    send({
      t: "host:create_property",
      data: {
        nombre: datosFmi.nombre,
        ciudad: datosFmi.ciudad,
        tipo: tipoDesdeNombre(datosFmi.nombre),
        matriculaInmobiliaria: datosFmi.fmi,
        areaM2: datosFmi.areaM2,
        avaluo: datosFmi.avaluo,
        ...(datosFmi.imagenUrl ? { imagenUrl: datosFmi.imagenUrl } : {}),
      },
    });
    setIntentoCreacion(true);
  }, [authed, state, datosFmi, intentoCreacion, send]);

  const rondaSectionRef = useRef<HTMLElement>(null);
  const [rondaPantallaCompleta, setRondaPantallaCompleta] = useState(false);

  useEffect(() => {
    const onFsChange = () => {
      setRondaPantallaCompleta(document.fullscreenElement === rondaSectionRef.current);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleRondaPantallaCompleta = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      rondaSectionRef.current?.requestFullscreen?.();
    }
  }, []);

  // Al presionar "Terminar" no cerramos la pestaña: guardamos una foto del
  // resultado para mostrar el ganador, y solo "Abortar" (despues de verlo)
  // cierra/redirige. Si se arma una ronda nueva sin cerrar la pestaña,
  // limpiamos esta foto para no tapar la ronda nueva.
  const [rondaGanador, setRondaGanador] = useState<{
    roundId: string;
    propiedad: { nombre: string; ciudad?: string };
    ganador: { playerId: string; nickname: string; valorFinal: number } | null;
  } | null>(null);

  useEffect(() => {
    if (rondaGanador && state?.rondaActual && state.rondaActual.roundId !== rondaGanador.roundId) {
      setRondaGanador(null);
    }
  }, [state?.rondaActual?.roundId, rondaGanador]);

  // Cuando se llega desde un FMI especifico (boton "Subastar" del portafolio),
  // el historial arranca filtrado a ese inmueble; el host puede expandirlo a todos.
  const [historialSoloEsteInmueble, setHistorialSoloEsteInmueble] = useState(true);

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-archivo via-navy3 to-archivo text-manila font-body">
        <div className="bg-manila text-archivo rounded-xl p-8 w-full max-w-sm">
          <BrandMark className="w-12 h-12 mb-3" />
          <h1 className="font-display text-2xl mb-4">Consola del presentador</h1>

          {supabase ? (
            <>
              <input
                className="w-full mb-3 px-3 py-2 rounded border border-archivo/30"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="correo@empresa.com"
                autoComplete="username"
              />
              <input
                className="w-full mb-4 px-3 py-2 rounded border border-archivo/30"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Contraseña"
                autoComplete="current-password"
                onKeyDown={(e) => e.key === "Enter" && loginConSupabase()}
              />
              {loginError && (
                <p role="alert" className="text-sm text-archivo bg-sello/10 border border-sello/40 rounded px-3 py-2 mb-3">
                  {loginError}
                </p>
              )}
              <button
                className="w-full bg-gradient-to-r from-azul to-navy3 text-manila py-3 rounded font-display transition-transform duration-150 ease-out hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 disabled:active:scale-100"
                disabled={!connected || loggingIn || !email || !password}
                onClick={loginConSupabase}
              >
                {loggingIn ? "Entrando..." : "Entrar"}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm opacity-70 mb-3">
                Supabase no está configurado en este entorno; usando token de desarrollo.
              </p>
              <input
                className="w-full mb-4 px-3 py-2 rounded border border-archivo/30"
                value={devToken}
                onChange={(e) => setDevToken(e.target.value)}
                placeholder="Token"
              />
              <button
                className="w-full bg-gradient-to-r from-azul to-navy3 text-manila py-3 rounded font-display transition-transform duration-150 ease-out hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 disabled:active:scale-100"
                disabled={!connected}
                onClick={loginConToken}
              >
                Entrar
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const disponibles = state?.properties.filter((p) => p.estado === "disponible") ?? [];
  // Busca por FMI entre TODOS los inmuebles (no solo los "disponibles"): es
  // un juego, si ya se subasto/adjudico antes debe poder volver a subastarse
  // sin problema con solo presionar "Subastar" de nuevo. Solo se excluye
  // "en_subasta" porque eso significa que ya hay una ronda corriendo con el
  // (armRound del servidor rechaza intentar armarlo de nuevo en ese caso).
  const propiedadPendiente = fmiParam
    ? state?.properties.find(
        (p) => p.matriculaInmobiliaria === fmiParam && p.estado !== "en_subasta"
      ) ?? null
    : null;
  const enSubasta = state?.properties.filter((p) => p.estado === "en_subasta") ?? [];
  const adjudicadas = state?.properties.filter((p) => p.estado === "adjudicado") ?? [];
  const pin = state?.pin ?? "----";

  return (
    <div className="min-h-screen bg-escenario text-manila font-body p-6 lg:p-8">
      {/* ---------- Header: título + acciones de cuenta ---------- */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl">Consola del presentador</h1>
          <p className="opacity-70 text-sm mt-1">
            estado: <span className="font-mono">{state?.estado ?? "-"}</span> · {state?.jugadores.length ?? 0} jugadores
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="bg-manila/10 border border-manila/30 text-manila px-3 py-1.5 rounded text-sm transition-transform duration-150 ease-out hover:scale-105 active:scale-95"
            onClick={() => window.open("/screen", "_blank")}
          >
            Abrir pantalla proyector
          </button>
          <button
            type="button"
            className="bg-manila/10 border border-manila/30 text-manila px-3 py-1.5 rounded text-sm transition-transform duration-150 ease-out hover:scale-105 active:scale-95"
            onClick={() => setShowAdminForm(true)}
          >
            + Nuevo administrador
          </button>
          <button
            type="button"
            className="bg-manila/10 border border-manila/30 text-manila px-3 py-1.5 rounded text-sm transition-transform duration-150 ease-out hover:scale-105 active:scale-95"
            onClick={logout}
          >
            Cerrar sesión
          </button>
        </div>
      </div>

      {actionError && (
        <div role="alert" className="bg-sello/90 text-manila rounded-lg px-4 py-2 mb-6 flex items-center justify-between gap-3">
          <span>{actionError}</span>
          <button
            type="button"
            aria-label="Cerrar aviso"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded hover:bg-manila/10 transition-transform duration-150 ease-out hover:scale-105 active:scale-95"
            onClick={() => setActionError(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* ---------- Ronda actual: el bloque más usado durante el evento ---------- */}
      <Section
        titulo="Ronda actual"
        destacado
        sectionRef={rondaSectionRef}
        accion={
          <button
            type="button"
            title={rondaPantallaCompleta ? "Salir de pantalla completa" : "Ver en pantalla completa"}
            className="inline-flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 rounded-full text-xs font-display font-bold uppercase tracking-wide bg-archivo/10 border border-manila/20 text-manila/90 transition-all duration-150 ease-out hover:bg-archivo/20 hover:scale-105 active:scale-95"
            onClick={toggleRondaPantallaCompleta}
          >
            {rondaPantallaCompleta ? "Salir" : "Pantalla completa"}
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-3.5 h-3.5"
              aria-hidden="true"
            >
              {rondaPantallaCompleta ? (
                <path d="M8 4v2.5A1.5 1.5 0 0 1 6.5 8H4M12 4v2.5A1.5 1.5 0 0 0 13.5 8H16M8 16v-2.5A1.5 1.5 0 0 0 6.5 12H4M12 16v-2.5a1.5 1.5 0 0 1 1.5-1.5H16" />
              ) : (
                <path d="M4 7V5a1 1 0 0 1 1-1h2M16 7V5a1 1 0 0 0-1-1h-2M4 13v2a1 1 0 0 0 1 1h2M16 13v2a1 1 0 0 1-1 1h-2" />
              )}
            </svg>
          </button>
        }
      >
        {rondaGanador ? (
          <div className="text-center py-10">
            <p className="text-oro font-display text-xs font-bold uppercase tracking-[0.2em] mb-4">
              Subasta finalizada
            </p>
            <p className="font-display text-2xl font-bold">{rondaGanador.propiedad.nombre}</p>
            {rondaGanador.propiedad.ciudad && (
              <p className="opacity-60 text-sm mt-1 mb-6">{rondaGanador.propiedad.ciudad}</p>
            )}
            {rondaGanador.ganador ? (
              <div className="mt-6">
                <p className="text-5xl mb-2" aria-hidden="true">
                  🏆
                </p>
                <p className="font-display text-3xl font-extrabold text-oro">{rondaGanador.ganador.nickname}</p>
                <p className="font-mono tabular text-xl opacity-80 mt-1">
                  {rondaGanador.ganador.valorFinal.toLocaleString("es-CO")} COP
                </p>
              </div>
            ) : (
              <p className="opacity-70 text-lg mt-6">Nadie pujó por este inmueble.</p>
            )}
            <div className="mt-10">
              <button
                type="button"
                className="bg-sello/80 text-manila px-6 py-3 rounded font-display transition-transform duration-150 ease-out hover:scale-105 active:scale-95"
                onClick={() => {
                  setRondaGanador(null);
                  window.close();
                }}
              >
                Abortar
              </button>
            </div>
          </div>
        ) : state?.rondaActual ? (
          <>
            <div className="text-center mb-6">
              <div className="flex items-center justify-center gap-2 mb-4">
                <span className="text-oro font-display text-xs font-bold uppercase tracking-[0.2em]">
                  Lote en subasta
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-display font-bold uppercase tracking-wide ${
                    state.rondaActual.estado === "running"
                      ? "bg-sello/90 text-manila"
                      : state.rondaActual.estado === "ended"
                        ? "bg-manila/15 text-manila/80"
                        : "bg-oro/90 text-archivo"
                  }`}
                >
                  {state.rondaActual.estado === "running" && (
                    <span className="w-1.5 h-1.5 rounded-full bg-manila animate-pulse" aria-hidden="true" />
                  )}
                  {state.rondaActual.estado === "running"
                    ? "En vivo"
                    : state.rondaActual.estado === "ended"
                      ? "Finalizada"
                      : "Armada · esperando"}
                </span>
              </div>

              <div className="relative w-full max-w-md mx-auto mb-3">
                {state.rondaActual.propiedad.imagenUrl ? (
                  <img
                    src={state.rondaActual.propiedad.imagenUrl}
                    alt={state.rondaActual.propiedad.nombre}
                    className="w-full h-64 object-cover rounded-xl border-2 border-oro/60 shadow-lg shadow-black/30"
                  />
                ) : (
                  <div className="w-full h-64 rounded-xl border-2 border-oro/60 bg-navy3/40 flex items-center justify-center text-4xl">
                    🏛️
                  </div>
                )}
                <span className="absolute top-3 left-3 bg-archivo/85 text-oro font-mono text-xs px-2.5 py-1 rounded-full border border-oro/40">
                  FMI {state.rondaActual.propiedad.matriculaInmobiliaria}
                </span>
              </div>

              <p className="font-display text-2xl font-bold">{state.rondaActual.propiedad.nombre}</p>
              {state.rondaActual.propiedad.ciudad && (
                <p className="opacity-60 text-sm mt-1">{state.rondaActual.propiedad.ciudad}</p>
              )}
            </div>

            {liveTick && liveTick.roundId === state.rondaActual.roundId && (
              <div className="text-center mb-6">
                <p className="text-oro font-display text-xs font-bold uppercase tracking-[0.2em] mb-1">
                  Puja actual
                </p>
                <p
                  key={liveTick.valorActual}
                  className={`font-display text-5xl lg:text-6xl font-extrabold tabular text-oro ${
                    state.rondaActual.estado === "running" ? "winner-glow" : ""
                  }`}
                >
                  {liveTick.valorActual.toLocaleString("es-CO")}
                </p>
                <p className="opacity-50 text-xs mt-1">COP · {liveTick.tapsTotales} taps totales</p>
              </div>
            )}

            {liveTick && liveTick.roundId === state.rondaActual.roundId && liveTick.top.length > 0 && (
              <div
                ref={rankingFlipRef}
                className="flex items-end justify-center gap-3 mb-4 bg-gradient-to-b from-navy3/40 to-archivo/40 backdrop-blur-sm rounded-xl border border-oro/20 shadow-lg shadow-black/20 p-6"
              >
                {(() => {
                  const valorMaximo = Math.max(...liveTick.top.map((p) => p.valorPujado), 1);
                  return liveTick.top.map((p, i) => {
                    const pct = (p.valorPujado / valorMaximo) * 100;
                    const esLider = i === 0;
                    return (
                      <div key={p.playerId} data-flip-key={p.playerId} className="flex flex-col items-center w-12 shrink-0">
                        <div className="w-12 h-40 flex flex-col items-center justify-end">
                          {esLider && (
                            <span className="text-lg mb-1" aria-hidden="true">
                              🏆
                            </span>
                          )}
                          <div
                            className={`w-12 rounded-t-lg bg-azul/70 transition-all duration-300 ease-out ${
                              esLider ? "border-2 border-oro" : ""
                            }`}
                            style={{ height: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs mt-2 w-12 truncate text-center" title={p.nickname}>
                          {p.nickname}
                          {p.flagged && (
                            <span aria-label="marcado como sospechoso" title="Marcado como sospechoso">
                              {" "}
                              ⚠
                            </span>
                          )}
                        </span>
                        <span className="font-mono tabular text-[11px] mt-0.5 whitespace-nowrap">
                          {formatoCompacto(p.valorPujado)}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            )}

            {liveTick && liveTick.roundId === state.rondaActual.roundId && (
              <p
                key={Math.ceil(liveTick.remainingMs / 1000)}
                className="font-display text-3xl font-bold tabular text-center mb-4 countdown-pop"
              >
                {Math.ceil(liveTick.remainingMs / 1000)}s
              </p>
            )}

            <div className="flex gap-2 justify-center">
              {state.rondaActual.estado === "ended" ? (
                <>
                  <button
                    type="button"
                    className="bg-gradient-to-r from-azul to-navy3 text-manila px-4 py-2 rounded font-display transition-transform duration-150 ease-out hover:scale-105 active:scale-95"
                    onClick={() => {
                      setRondaGanador({
                        roundId: state.rondaActual!.roundId,
                        propiedad: {
                          nombre: state.rondaActual!.propiedad.nombre,
                          ciudad: state.rondaActual!.propiedad.ciudad,
                        },
                        ganador: state.rondaActual!.ganador,
                      });
                      send({ t: "host:close_round" });
                    }}
                  >
                    Terminar
                  </button>
                  <button
                    type="button"
                    className="bg-manila/10 border border-manila/30 text-manila px-4 py-2 rounded font-display transition-transform duration-150 ease-out hover:scale-105 active:scale-95"
                    onClick={() => send({ t: "host:repeat", roundId: state.rondaActual!.roundId })}
                  >
                    Repetir ronda
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="bg-sello/80 text-manila px-4 py-2 rounded font-display transition-transform duration-150 ease-out hover:scale-105 active:scale-95"
                  onClick={() => {
                    send({ t: "host:abort" });
                    window.close();
                  }}
                >
                  Abortar
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="text-center py-8">
            {propiedadPendiente ? (
              <>
                <p className="text-oro font-display text-xs font-bold uppercase tracking-[0.2em] mb-4">
                  Lote listo para subastar
                </p>
                <div className="relative w-full max-w-sm mx-auto mb-4">
                  {propiedadPendiente.imagenUrl ? (
                    <img
                      src={propiedadPendiente.imagenUrl}
                      alt={propiedadPendiente.nombre}
                      className="w-full h-48 object-cover rounded-xl border-2 border-oro/60 shadow-lg shadow-black/30"
                    />
                  ) : (
                    <div className="w-full h-48 rounded-xl border-2 border-oro/60 bg-navy3/40 flex items-center justify-center text-4xl">
                      🏛️
                    </div>
                  )}
                  <span className="absolute top-3 left-3 bg-archivo/85 text-oro font-mono text-xs px-2.5 py-1 rounded-full border border-oro/40">
                    FMI {propiedadPendiente.matriculaInmobiliaria}
                  </span>
                </div>
                <p className="font-display text-xl font-bold mb-4">{propiedadPendiente.nombre}</p>
                <button
                  type="button"
                  className="bg-gradient-to-r from-azul to-navy3 text-manila px-6 py-3 rounded font-display transition-transform duration-150 ease-out hover:scale-105 active:scale-95"
                  onClick={() => send({ t: "host:arm", propertyId: propiedadPendiente.id })}
                >
                  Subastar para comenzar
                </button>
                <p className="opacity-50 text-sm mt-3">
                  Abre "Abrir pantalla proyector" para que los jugadores se registren con el QR antes de empezar.
                </p>
              </>
            ) : (
              <>
                <p className="opacity-70">
                  Selecciona un inmueble para subastar desde el botón "Subastar" del portafolio público.
                </p>
                <p className="opacity-50 text-sm mt-2">
                  Cuando entres desde ese enlace, aparecerá aquí el botón para confirmar y empezar la ronda.
                </p>
              </>
            )}
          </div>
        )}
      </Section>

      {/* ---------- Historial de subastas ---------- */}
      {(() => {
        const filtrarPorFmi = Boolean(fmiParam) && historialSoloEsteInmueble;
        const historialMostrado = filtrarPorFmi
          ? (state?.historial ?? []).filter((r) => r.propiedad.matriculaInmobiliaria === fmiParam)
          : state?.historial ?? [];
        return (
          <Section
            titulo="Historial de subastas"
            collapsible
            defaultOpen={false}
            accion={
              fmiParam ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-display font-bold uppercase tracking-wide bg-archivo/10 border border-manila/20 text-manila/90 transition-all duration-150 ease-out hover:bg-archivo/20 hover:scale-105 active:scale-95"
                  onClick={() => setHistorialSoloEsteInmueble((v) => !v)}
                >
                  {historialSoloEsteInmueble ? "Solo este inmueble" : "Ver todo"}
                </button>
              ) : undefined
            }
          >
        {historialMostrado.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left opacity-60 uppercase text-xs tracking-wide">
                  <th className="py-2 pr-4">Inmueble</th>
                  <th className="py-2 pr-4">FMI</th>
                  <th className="py-2 pr-4">Resultado</th>
                  <th className="py-2 pr-4">Ganador</th>
                  <th className="py-2 pr-4">Valor final</th>
                  <th className="py-2 pr-4">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {historialMostrado.map((r) => (
                  <tr key={r.roundId} className="border-t border-manila/10">
                    <td className="py-2 pr-4 font-display font-semibold">{r.propiedad.nombre}</td>
                    <td className="py-2 pr-4 font-mono text-xs opacity-70">{r.propiedad.matriculaInmobiliaria}</td>
                    <td className="py-2 pr-4">
                      {r.ganador ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-display font-bold uppercase tracking-wide bg-esmeralda/20 text-esmeralda">
                          Adjudicada
                        </span>
                      ) : r.abortada ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-display font-bold uppercase tracking-wide bg-sello/20 text-sello">
                          Abortada
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-display font-bold uppercase tracking-wide bg-manila/10 text-manila/70">
                          Sin pujas
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">{r.ganador?.nickname ?? "-"}</td>
                    <td className="py-2 pr-4 font-mono tabular text-oro">
                      {r.ganador ? `${r.ganador.valorFinal.toLocaleString("es-CO")} COP` : "-"}
                    </td>
                    <td className="py-2 pr-4 text-xs opacity-70 whitespace-nowrap">
                      {new Date(r.finalizadaEn).toLocaleString("es-CO", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="opacity-60 text-sm">
            {filtrarPorFmi
              ? "Todavía no hay subastas registradas para este inmueble."
              : "Todavía no hay subastas finalizadas con ganador."}
          </p>
        )}
          </Section>
        );
      })()}

      {/* ---------- Jugadores ---------- */}
      <Section titulo="Jugadores">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="bg-manila/10 border border-manila/30 px-4 py-2 rounded font-display transition-transform duration-150 ease-out hover:scale-105 active:scale-95"
            onClick={() => setShowJugadores(true)}
          >
            Ver participantes ({state?.jugadores.length ?? 0})
          </button>
          <button
            type="button"
            className="bg-sello/80 text-manila px-4 py-2 rounded font-display transition-transform duration-150 ease-out hover:scale-105 active:scale-95"
            onClick={reiniciarJugadores}
          >
            Reiniciar jugadores
          </button>
        </div>
      </Section>

      {/* ---------- Modal crear/editar inmueble ---------- */}
      {showForm && (
        <div className="fixed inset-0 bg-archivo/80 flex items-center justify-center p-4 modal-backdrop-in">
          <div className="bg-manila text-archivo rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto modal-panel-in">
            <h2 className="font-display text-xl mb-4">{editingId ? "Editar inmueble" : "Nuevo inmueble"}</h2>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide opacity-70">
                Nombre
                <input
                  className="normal-case px-3 py-2 rounded border border-archivo/30 text-base"
                  placeholder="Nombre del inmueble"
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide opacity-70">
                Ciudad
                <input
                  className="normal-case px-3 py-2 rounded border border-archivo/30 text-base"
                  placeholder="Ciudad"
                  value={form.ciudad}
                  onChange={(e) => setForm({ ...form, ciudad: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide opacity-70">
                Tipo
                <input
                  className="normal-case px-3 py-2 rounded border border-archivo/30 text-base"
                  placeholder="Apartamento, lote, local..."
                  value={form.tipo}
                  onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide opacity-70">
                Matrícula inmobiliaria
                <input
                  className="normal-case px-3 py-2 rounded border border-archivo/30 text-base"
                  placeholder="Matrícula inmobiliaria"
                  value={form.matriculaInmobiliaria}
                  onChange={(e) => setForm({ ...form, matriculaInmobiliaria: e.target.value })}
                />
              </label>
              <div className="flex gap-3">
                <label className="flex-1 flex flex-col gap-1 text-xs uppercase tracking-wide opacity-70">
                  Área (m²)
                  <input
                    className="normal-case px-3 py-2 rounded border border-archivo/30 text-base"
                    type="number"
                    placeholder="Área"
                    value={form.areaM2 || ""}
                    onChange={(e) => setForm({ ...form, areaM2: Number(e.target.value) })}
                  />
                </label>
                <label className="flex-1 flex flex-col gap-1 text-xs uppercase tracking-wide opacity-70">
                  Avalúo (COP)
                  <input
                    className="normal-case px-3 py-2 rounded border border-archivo/30 text-base"
                    type="number"
                    placeholder="Avalúo"
                    value={form.avaluo || ""}
                    onChange={(e) => setForm({ ...form, avaluo: Number(e.target.value) })}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-wide opacity-70">
                Descripción (opcional)
                <textarea
                  className="normal-case px-3 py-2 rounded border border-archivo/30 text-base"
                  placeholder="Descripción"
                  value={form.descripcion}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                />
              </label>
              {supabase ? (
                <div>
                  <label className="block text-xs uppercase tracking-wide opacity-70 mb-1">
                    Foto del inmueble (opcional)
                  </label>
                  {form.imagenUrl && (
                    <img
                      src={form.imagenUrl}
                      alt="Vista previa"
                      className="w-full h-32 object-cover rounded border border-archivo/20 mb-2"
                    />
                  )}
                  <input
                    className="w-full text-sm"
                    type="file"
                    accept="image/*"
                    disabled={uploadingImage}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) subirImagen(file);
                    }}
                  />
                  {uploadingImage && <p className="text-xs opacity-60 mt-1">Subiendo...</p>}
                  {uploadError && (
                    <p role="alert" className="text-xs text-archivo bg-sello/10 border border-sello/40 rounded px-2 py-1 mt-1">
                      {uploadError}
                    </p>
                  )}
                </div>
              ) : (
                <label className="flex flex-col gap-1 text-xs uppercase tracking-wide opacity-70">
                  URL de imagen (opcional)
                  <input
                    className="normal-case px-3 py-2 rounded border border-archivo/30 text-base"
                    placeholder="https://..."
                    value={form.imagenUrl}
                    onChange={(e) => setForm({ ...form, imagenUrl: e.target.value })}
                  />
                </label>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                type="button"
                className="bg-gradient-to-r from-azul to-navy3 text-manila px-4 py-2 rounded font-display flex-1 transition-transform duration-150 ease-out hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 disabled:active:scale-100"
                disabled={
                  !form.nombre ||
                  !form.ciudad ||
                  !form.tipo ||
                  !form.matriculaInmobiliaria ||
                  !form.areaM2 ||
                  !form.avaluo ||
                  uploadingImage
                }
                onClick={submitForm}
              >
                {editingId ? "Guardar cambios" : "Crear inmueble"}
              </button>
              <button
                type="button"
                className="bg-archivo/10 px-4 py-2 rounded font-display transition-transform duration-150 ease-out hover:scale-105 active:scale-95"
                onClick={closeForm}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Modal lista de participantes ---------- */}
      {showJugadores && (
        <div className="fixed inset-0 bg-archivo/80 flex items-center justify-center p-4 modal-backdrop-in">
          <div className="bg-manila text-archivo rounded-xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto modal-panel-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-xl">Participantes ({state?.jugadores.length ?? 0})</h2>
              <button
                type="button"
                className="bg-archivo/10 border border-archivo/30 hover:bg-archivo/20 text-archivo text-sm px-4 py-2 rounded-full font-display transition-colors"
                onClick={() => setShowJugadores(false)}
              >
                Cerrar
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {state?.jugadores.map((j) => (
                <div key={j.playerId} className="bg-archivo/5 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-display">
                      {j.nickname}
                      {j.flagged && (
                        <span aria-label="marcado como sospechoso" title="Marcado como sospechoso" className="ml-1">
                          ⚠
                        </span>
                      )}
                    </p>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        j.conectado ? "bg-esmeralda text-archivo" : "bg-archivo/10"
                      }`}
                    >
                      {j.conectado ? "conectado" : "desconectado"}
                    </span>
                  </div>
                  <p className="text-sm opacity-70">{j.telefono || "sin celular"}</p>
                  <p className="text-sm opacity-70">{j.correo || "sin correo"}</p>
                </div>
              ))}
              {(state?.jugadores.length ?? 0) === 0 && (
                <p className="opacity-50 text-sm">Todavía no se ha registrado nadie.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------- Modal crear administrador ---------- */}
      {showAdminForm && (
        <div className="fixed inset-0 bg-archivo/80 flex items-center justify-center p-4 modal-backdrop-in">
          <div className="bg-manila text-archivo rounded-xl p-6 w-full max-w-sm modal-panel-in">
            <h2 className="font-display text-xl mb-1">Nuevo administrador</h2>
            <p className="text-sm opacity-70 mb-4">
              Se crea directamente en Supabase Auth y puede entrar a esta consola de inmediato.
            </p>

            {adminMsg && (
              <p className={`text-sm mb-3 ${adminMsg.tipo === "ok" ? "text-esmeralda" : "text-archivo bg-sello/10 border border-sello/40 rounded px-3 py-2"}`}>
                {adminMsg.texto}
              </p>
            )}

            <label className="block text-xs uppercase tracking-wide mb-1">Correo</label>
            <input
              className="w-full mb-3 px-3 py-2 rounded border border-archivo/30"
              type="email"
              value={nuevoAdminEmail}
              onChange={(e) => setNuevoAdminEmail(e.target.value)}
              placeholder="nuevo.admin@empresa.com"
            />

            <label className="block text-xs uppercase tracking-wide mb-1">Contraseña</label>
            <input
              className="w-full mb-1 px-3 py-2 rounded border border-archivo/30"
              type="password"
              value={nuevoAdminPassword}
              onChange={(e) => setNuevoAdminPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
            />
            <p className="text-xs opacity-50 mb-4">Mínimo 6 caracteres.</p>

            <div className="flex gap-2">
              <button
                type="button"
                className="bg-gradient-to-r from-azul to-navy3 text-manila px-4 py-2 rounded font-display flex-1 transition-transform duration-150 ease-out hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 disabled:active:scale-100"
                disabled={!emailAdminValido || !passwordValida || creandoAdmin}
                onClick={crearAdmin}
              >
                {creandoAdmin ? "Creando..." : "Crear administrador"}
              </button>
              <button
                type="button"
                className="bg-archivo/10 px-4 py-2 rounded font-display transition-transform duration-150 ease-out hover:scale-105 active:scale-95"
                onClick={() => {
                  setShowAdminForm(false);
                  setAdminMsg(null);
                }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Tarjeta de sección con header (font-display + línea separadora),
 * opcionalmente colapsable y opcionalmente "destacada" (borde/fondo
 * distinto) para la sección que más se usa en vivo — Ronda actual.
 */
function Section({
  titulo,
  children,
  collapsible = false,
  defaultOpen = true,
  destacado = false,
  accion,
  sectionRef,
}: {
  titulo: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  destacado?: boolean;
  accion?: React.ReactNode;
  sectionRef?: React.RefObject<HTMLElement>;
}) {
  const [abierto, setAbierto] = useState(defaultOpen);
  return (
    <section
      ref={sectionRef}
      className={`mb-6 rounded-xl p-4 lg:p-5 [&:fullscreen]:mb-0 [&:fullscreen]:h-screen [&:fullscreen]:w-screen [&:fullscreen]:flex [&:fullscreen]:flex-col [&:fullscreen]:justify-center [&:fullscreen]:overflow-auto [&:fullscreen]:rounded-none [&:fullscreen]:bg-archivo [&:fullscreen]:p-10 ${
        destacado ? "border-2 border-oro/50 bg-oro/[0.06]" : "border border-manila/10 bg-manila/10"
      }`}
    >
      <div className="flex items-center justify-between border-b border-manila/15 pb-2 mb-4 gap-3">
        <h2 className="font-display text-lg tracking-wide">{titulo}</h2>
        <div className="flex items-center gap-3">
          {accion}
          {collapsible && (
            <button
              type="button"
              aria-expanded={abierto}
              className="inline-flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 rounded-full text-xs font-display font-bold uppercase tracking-wide bg-archivo/10 border border-manila/20 text-manila/90 transition-all duration-150 ease-out hover:bg-archivo/20 hover:scale-105 active:scale-95"
              onClick={() => setAbierto((a) => !a)}
            >
              {abierto ? "Ocultar" : "Mostrar"}
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`w-3 h-3 transition-transform duration-200 ease-out ${abierto ? "rotate-180" : ""}`}
                aria-hidden="true"
              >
                <path d="M5 7.5 10 12.5 15 7.5" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {(!collapsible || abierto) && children}
    </section>
  );
}
