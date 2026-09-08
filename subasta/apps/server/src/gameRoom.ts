import { WebSocket } from "ws";
import { nanoid } from "nanoid";
import {
  GAME_CONSTANTS,
  type PlayerSummary,
  type PropertyInput,
} from "@subasta/shared";
import {
  loadProperties,
  createProperty,
  updateProperty,
  archiveProperty,
  setPropertyEstado,
  logPlayerLogin,
  logRoundResult,
  fetchHistorial,
  deletePlayerLogins,
} from "./propertiesRepo.js";
import type { HistorialEntry, PlayerConn, RoomState, RoundState } from "./types.js";

function safeSend(socket: WebSocket | null, payload: unknown) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

/**
 * PIN de 6 dígitos para el QR de la subasta actual. Se genera uno nuevo cada
 * vez que el admin "reinicia jugadores" (arranca una subasta nueva), para que
 * el QR/enlace de una subasta anterior deje de servir y los clientes que se
 * registraron con ese QR viejo nunca se mezclen con los de la subasta nueva.
 */
function generarPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export class GameRoom {
  state: RoomState = {
    pin: generarPin(),
    valorPorTap: GAME_CONSTANTS.DEFAULT_VALOR_POR_TAP,
    estado: "lobby",
    players: new Map(),
    properties: [],
    currentRound: null,
    roundHistory: [],
    historial: [],
    screens: new Set(),
    hosts: new Set(),
  };

  private tickInterval: NodeJS.Timeout | null = null;

  now() {
    return Date.now();
  }

  // ---------- Arranque ----------

  async initProperties() {
    this.state.properties = await loadProperties();
    await this.repararPropiedadesEnSubastaHuerfanas();
    this.state.historial = await fetchHistorial(30);
    this.broadcastHostState();
  }

  /**
   * Registra el resultado de una ronda (con o sin ganador, abortada o no) en Supabase
   * y lo agrega de una vez al historial en memoria, para que el panel del host lo
   * muestre sin depender de que el insert a la base de datos ya haya vuelto.
   * Este historial sobrevive reinicios del servidor porque se recarga desde
   * Supabase en initProperties().
   */
  private registrarEnHistorial(round: RoundState, abortada: boolean) {
    const endedAt = this.now();
    const entry: HistorialEntry = {
      roundId: round.roundId,
      propiedad: {
        nombre: round.propiedad.nombre,
        matriculaInmobiliaria: round.propiedad.matriculaInmobiliaria,
        ciudad: round.propiedad.ciudad,
      },
      ganador: round.ganador,
      abortada,
      finalizadaEn: endedAt,
    };
    this.state.historial = [entry, ...this.state.historial].slice(0, 30);

    logRoundResult({
      propertyId: round.propiedad.id,
      propertyNombre: round.propiedad.nombre,
      propertyFmi: round.propiedad.matriculaInmobiliaria,
      propertyCiudad: round.propiedad.ciudad,
      winnerNickname: round.ganador?.nickname ?? null,
      winnerTaps: round.ganador ? round.counts.get(round.ganador.playerId) ?? 0 : 0,
      valorFinal: round.ganador?.valorFinal ?? 0,
      startedAt: round.startAt,
      endedAt,
      abortada,
    }).catch(() => {});
  }

  /**
   * currentRound nunca se persiste, así que si el servidor se reinicia a mitad de una
   * ronda (por ejemplo en un deploy de Render), el inmueble queda atascado en
   * "en_subasta" en la base de datos sin ninguna ronda que lo vaya a cerrar. Al
   * arrancar, currentRound siempre es null, así que cualquier inmueble en
   * "en_subasta" en ese momento es huérfano: lo liberamos a "disponible".
   */
  private async repararPropiedadesEnSubastaHuerfanas() {
    const huerfanas = this.state.properties.filter(
      (p) => p.estado === "en_subasta" && this.state.currentRound?.propiedad.id !== p.id
    );
    for (const p of huerfanas) {
      this.setLocalPropertyEstado(p.id, "disponible");
      await setPropertyEstado(p.id, "disponible");
    }
  }

  // ---------- Conexiones ----------

  joinPlayer(
    nickname: string,
    telefono: string,
    correo: string,
    resumeToken: string | undefined,
    socket: WebSocket
  ) {
    let player: PlayerConn;
    if (resumeToken) {
      const existing = [...this.state.players.values()].find((p) => p.resumeToken === resumeToken);
      if (existing) {
        existing.socket = socket;
        existing.nickname = nickname || existing.nickname;
        existing.telefono = telefono || existing.telefono;
        existing.correo = correo || existing.correo;
        player = existing;
        this.broadcastHostState();
        logPlayerLogin({ eventPin: this.state.pin, nickname: player.nickname, playerId: player.playerId, telefono, correo }).catch(
          () => {}
        );
        return player;
      }
    }
    player = {
      playerId: nanoid(10),
      nickname: nickname.slice(0, 24) || `Jugador-${nanoid(4)}`,
      telefono,
      correo,
      resumeToken: resumeToken || nanoid(16),
      socket,
      lastSeq: -1,
    };
    this.state.players.set(player.playerId, player);
    this.broadcastLobby();
    this.broadcastHostState();
    logPlayerLogin({ eventPin: this.state.pin, nickname: player.nickname, playerId: player.playerId, telefono, correo }).catch(
      () => {}
    );
    return player;
  }

  /**
   * Estado de la ronda en curso visto desde un jugador puntual. Se usa al
   * (re)conectarse -- primera vez, reconexion automatica tras caida de wifi,
   * o reapertura de la pagina con el resumeToken guardado -- para que el
   * cliente pueda reanudar directo en la pantalla correcta (armada o
   * corriendo, con sus taps y posicion reales) en vez de quedarse pegado en
   * "esperando" mientras la ronda sigue corriendo sin que la vea.
   */
  getRondaActualParaJugador(playerId: string) {
    const round = this.state.currentRound;
    if (!round || (round.estado !== "armed" && round.estado !== "running")) return null;
    const ranking = this.rankRound(round);
    const positions = this.buildPositions(ranking);
    const lider = ranking.length > 0 && ranking[0].taps > 0 ? { nickname: ranking[0].nickname, taps: ranking[0].taps } : null;
    return {
      roundId: round.roundId,
      propiedad: round.propiedad,
      startAt: round.startAt,
      duracionMs: round.duracionMs,
      estado: round.estado as "armed" | "running",
      misTaps: round.counts.get(playerId) ?? 0,
      miPosicion: positions.get(playerId) ?? ranking.length + 1,
      lider,
    };
  }

  addScreen(socket: WebSocket) {
    this.state.screens.add(socket);
    this.broadcastLobby();
  }

  removeScreen(socket: WebSocket) {
    this.state.screens.delete(socket);
  }

  addHost(socket: WebSocket) {
    this.state.hosts.add(socket);
    this.broadcastHostState();
  }

  removeHost(socket: WebSocket) {
    this.state.hosts.delete(socket);
  }

  disconnectPlayer(playerId: string) {
    const p = this.state.players.get(playerId);
    if (p) p.socket = null;
    this.broadcastHostState();
  }

  // ---------- Mensajería jugador ----------

  handlePing(playerId: string, t0: number) {
    const p = this.state.players.get(playerId);
    if (!p) return;
    safeSend(p.socket, { t: "pong", t0, t1: this.now() });
  }

  handleTapBatch(
    playerId: string,
    msg: { roundId: string; seq: number; count: number; firstTs: number; lastTs: number; jitter: number }
  ) {
    const round = this.state.currentRound;
    if (!round || round.roundId !== msg.roundId || round.estado !== "running") return;

    const seen = round.seqSeen.get(playerId) ?? new Set<number>();
    if (seen.has(msg.seq)) return; // dedup por reenvío
    seen.add(msg.seq);
    round.seqSeen.set(playerId, seen);

    // Ventana de tiempo autoritativa (ver plan 2.2 / 2.3)
    const windowEnd = round.startAt + round.duracionMs + GAME_CONSTANTS.GRACE_MS;
    if (msg.lastTs < round.startAt || msg.lastTs > windowEnd) {
      const rec = round.recortados.get(playerId) ?? 0;
      round.recortados.set(playerId, rec + msg.count);
      return;
    }

    // ---------- Anti-trampa: autoclickers ----------
    // Límite de velocidad físico: cada jugador tiene un balde de taps que se
    // recarga a un ritmo humano posible (GAME_CONSTANTS.TOKEN_BUCKET_*). No
    // importa si el toque viene de un dedo real o de una app de autoclick en
    // el celular (que genera toques "de verdad" a nivel del sistema operativo
    // y por lo tanto no se puede filtrar en el navegador) -- si la tasa
    // sostenida supera lo que un pulgar puede hacer, el exceso simplemente no
    // suma puntos, igual que los taps fuera de la ventana de tiempo.
    const ahora = this.now();
    const ultimaRecarga = round.tokensUpdatedAt.get(playerId) ?? ahora;
    const segundosTranscurridos = Math.max(0, (ahora - ultimaRecarga) / 1000);
    const tokensPrevios = round.tokens.get(playerId) ?? GAME_CONSTANTS.TOKEN_BUCKET_CAPACITY;
    const tokensRecargados = Math.min(
      GAME_CONSTANTS.TOKEN_BUCKET_CAPACITY,
      tokensPrevios + segundosTranscurridos * GAME_CONSTANTS.TOKEN_BUCKET_REFILL_PER_SEC
    );
    const aceptados = Math.min(msg.count, Math.floor(tokensRecargados));
    const rechazadosPorVelocidad = msg.count - aceptados;
    round.tokens.set(playerId, tokensRecargados - aceptados);
    round.tokensUpdatedAt.set(playerId, ahora);
    if (rechazadosPorVelocidad > 0) {
      const rec = round.recortados.get(playerId) ?? 0;
      round.recortados.set(playerId, rec + rechazadosPorVelocidad);
    }

    // Detección por regularidad: un humano tocando rápido varía sus tiempos
    // entre taps (jitter); un autoclicker por software tiende a intervalos
    // casi idénticos. Si llegan varios lotes seguidos con jitter
    // sospechosamente bajo (y suficientes taps para que el dato sea
    // confiable), se marca al jugador como sospechoso -- se ve en el ranking
    // del host con una bandera, sin bloquearlo, para no perder por falso
    // positivo a alguien con el pulso muy parejo.
    if (msg.count >= 3) {
      if (msg.jitter < GAME_CONSTANTS.JITTER_MIN_MS) {
        const racha = (round.jitterStreak.get(playerId) ?? 0) + 1;
        round.jitterStreak.set(playerId, racha);
        if (racha >= GAME_CONSTANTS.JITTER_FLAG_STREAK) {
          round.flaggedPlayers.add(playerId);
        }
      } else {
        round.jitterStreak.set(playerId, 0);
      }
    }

    if (aceptados === 0) return;

    const prev = round.counts.get(playerId) ?? 0;
    const next = prev + aceptados;
    round.counts.set(playerId, next);
    round.firstReachedAt.set(playerId, ahora);
  }

  // ---------- Administración de inmuebles (admin) ----------

  async createPropertyEntry(input: PropertyInput) {
    const property = await createProperty(input);
    this.state.properties.push(property);
    this.broadcastHostState();
    return property;
  }

  async updatePropertyEntry(propertyId: string, input: PropertyInput) {
    const property = await updateProperty(propertyId, input);
    const idx = this.state.properties.findIndex((p) => p.id === propertyId);
    if (idx >= 0) this.state.properties[idx] = property;
    if (this.state.currentRound?.propiedad.id === propertyId) {
      this.state.currentRound.propiedad = property;
    }
    this.broadcastHostState();
    return property;
  }

  async deletePropertyEntry(propertyId: string) {
    await archiveProperty(propertyId);
    this.state.properties = this.state.properties.filter((p) => p.id !== propertyId);
    this.broadcastHostState();
  }

  /** Vuelve a poner en subasta un inmueble ya adjudicado (o cualquiera). */
  async relistProperty(propertyId: string) {
    const updated = await setPropertyEstado(propertyId, "disponible");
    this.setLocalPropertyEstado(propertyId, "disponible");
    this.broadcastHostState();
    return updated;
  }

  private setLocalPropertyEstado(propertyId: string, estado: "disponible" | "en_subasta" | "adjudicado") {
    const idx = this.state.properties.findIndex((p) => p.id === propertyId);
    if (idx >= 0) this.state.properties[idx] = { ...this.state.properties[idx], estado };
  }

  // ---------- Ciclo de ronda (host) ----------

  async armRound(propertyId: string) {
    const propiedad = this.state.properties.find((p) => p.id === propertyId);
    if (!propiedad) throw new Error("Inmueble no encontrado");
    if (propiedad.estado === "en_subasta") throw new Error("Ese inmueble ya está en subasta");

    const roundId = nanoid(12);
    const startAt = this.now() + GAME_CONSTANTS.ARM_LEAD_MS;
    const propiedadEnSubasta = { ...propiedad, estado: "en_subasta" as const };
    const round: RoundState = {
      roundId,
      propiedad: propiedadEnSubasta,
      startAt,
      duracionMs: GAME_CONSTANTS.ROUND_DURATION_MS,
      estado: "armed",
      counts: new Map(),
      seqSeen: new Map(),
      recortados: new Map(),
      firstReachedAt: new Map(),
      ganador: null,
      tokens: new Map(),
      tokensUpdatedAt: new Map(),
      jitterStreak: new Map(),
      flaggedPlayers: new Set(),
    };
    this.state.currentRound = round;
    this.state.estado = "armed";
    this.setLocalPropertyEstado(propertyId, "en_subasta");

    const payload = {
      t: "round_armed" as const,
      roundId,
      propiedad: propiedadEnSubasta,
      startAt,
      duracionMs: round.duracionMs,
    };
    for (const p of this.state.players.values()) safeSend(p.socket, payload);
    for (const s of this.state.screens) safeSend(s, payload);
    this.broadcastHostState();

    // Persistir el cambio de estado sin bloquear el arranque de la ronda.
    setPropertyEstado(propertyId, "en_subasta").catch(() => {});

    // Programar el arranque exacto de la ronda contra el reloj del servidor.
    const delay = startAt - this.now();
    setTimeout(() => this.startTicking(roundId), Math.max(0, delay));
  }

  private startTicking(roundId: string) {
    const round = this.state.currentRound;
    if (!round || round.roundId !== roundId) return;
    round.estado = "running";
    this.state.estado = "running";

    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => this.broadcastTick(), 1000 / GAME_CONSTANTS.TICK_HZ_SCREEN);

    setTimeout(() => this.endRound(roundId), round.duracionMs);
  }

  /** Termina la ronda en curso antes de tiempo (sin adjudicar), notificando round_end a jugadores/pantallas. */
  private abortCurrentRound() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    const round = this.state.currentRound;
    if (round) {
      this.setLocalPropertyEstado(round.propiedad.id, "disponible");
      setPropertyEstado(round.propiedad.id, "disponible").catch(() => {});

      const ranking = this.rankRound(round);
      const positions = this.buildPositions(ranking);
      for (const p of this.state.players.values()) {
        const misTaps = round.counts.get(p.playerId) ?? 0;
        const miPosicion = positions.get(p.playerId) ?? ranking.length + 1;
        safeSend(p.socket, {
          t: "round_end",
          roundId: round.roundId,
          ganador: null,
          miPosicion,
          misTaps,
          recortados: round.recortados.get(p.playerId) ?? 0,
        });
      }

      const top5 = ranking.slice(0, 5);
      const screenPayload = {
        t: "round_end" as const,
        roundId: round.roundId,
        ganador: null,
        valorFinal: 0,
        top5,
      };
      for (const s of this.state.screens) safeSend(s, screenPayload);

      // Si la ronda ya habia terminado sola (endRound) y solo estaba
      // esperando que el host presionara "Terminar", ya quedo registrada
      // en el historial alla -- no duplicarla aqui.
      if (round.estado !== "ended") {
        round.estado = "ended";
        round.abortada = true;
        this.state.roundHistory.push(round);
        this.registrarEnHistorial(round, true);
      }
    }
    this.state.currentRound = null;
  }

  /** El admin termina la ronda en curso antes de tiempo (sin adjudicar). */
  abortRound() {
    this.abortCurrentRound();
    this.state.estado = "lobby";
    this.broadcastHostState();
  }

  /**
   * El admin borra a todos los jugadores registrados, los manda de vuelta al
   * registro y arranca una subasta nueva con su propio PIN/QR. Así, el QR
   * anterior deja de servir para entrar (el servidor rechaza el PIN viejo) y
   * nadie que se haya registrado con él puede aparecer mezclado en la lista
   * de jugadores de esta subasta nueva.
   */
  resetPlayers() {
    const pinAnterior = this.state.pin;
    this.abortCurrentRound();
    for (const p of this.state.players.values()) {
      if (p.socket) safeSend(p.socket, { t: "reset" });
    }
    this.state.players.clear();
    this.state.estado = "lobby";
    this.state.pin = generarPin();
    deletePlayerLogins(pinAnterior).catch(() => {});
    this.broadcastLobby();
    this.broadcastHostState();
  }

  /** El admin cierra una ronda ya terminada (estado "ended") sin tocar el estado del inmueble. */
  closeRound() {
    this.state.currentRound = null;
    this.state.estado = "lobby";
    // Avisarle tambien a /screen (el proyector): sin esto, la pantalla se
    // queda pegada mostrando "Ha ganado..." para siempre, porque solo
    // abortRound() limpiaba esa pantalla, no closeRound().
    for (const s of this.state.screens) {
      safeSend(s, { t: "round_end" as const, roundId: "", ganador: null, valorFinal: 0, top5: [] });
    }
    this.broadcastHostState();
  }

  /** El admin reinicia/repite la subasta del mismo inmueble. */
  async repeatRound(roundId: string) {
    const past = this.state.roundHistory.find((r) => r.roundId === roundId) ?? this.state.currentRound;
    if (!past) throw new Error("Ronda no encontrada");
    await this.armRound(past.propiedad.id);
  }

  private endRound(roundId: string) {
    const round = this.state.currentRound;
    if (!round || round.roundId !== roundId) return;
    if (this.tickInterval) clearInterval(this.tickInterval);
    round.estado = "ended";
    this.state.estado = "ended";

    const ranking = this.rankRound(round);
    const winner = ranking[0];
    round.ganador = winner
      ? {
          playerId: winner.playerId,
          nickname: this.state.players.get(winner.playerId)?.nickname ?? "?",
          valorFinal: winner.valorPujado,
        }
      : null;

    this.state.roundHistory.push(round);
    this.registrarEnHistorial(round, false);

    // El inmueble queda adjudicado si hubo ganador; si no, vuelve a disponible.
    const nuevoEstado = round.ganador ? "adjudicado" : "disponible";
    this.setLocalPropertyEstado(round.propiedad.id, nuevoEstado);
    setPropertyEstado(round.propiedad.id, nuevoEstado).catch(() => {});

    const positions = this.buildPositions(ranking);
    for (const p of this.state.players.values()) {
      const misTaps = round.counts.get(p.playerId) ?? 0;
      const miPosicion = positions.get(p.playerId) ?? ranking.length + 1;
      safeSend(p.socket, {
        t: "round_end",
        roundId,
        ganador: round.ganador,
        miPosicion,
        misTaps,
        recortados: round.recortados.get(p.playerId) ?? 0,
      });
    }

    const top5 = ranking.slice(0, 5);
    const tapsTotalesFinal = [...round.counts.values()].reduce((a, b) => a + b, 0);
    const screenPayload = {
      t: "round_end" as const,
      roundId,
      ganador: round.ganador,
      valorFinal: round.ganador?.valorFinal ?? 0,
      top5,
      pujaFinal: this.calcularPujaActual(round.propiedad.avaluo, tapsTotalesFinal),
    };
    for (const s of this.state.screens) safeSend(s, screenPayload);
    this.broadcastHostState();
  }

  private rankRound(round: RoundState): PlayerSummary[] {
    const rows: PlayerSummary[] = [...this.state.players.values()].map((p) => {
      const taps = round.counts.get(p.playerId) ?? 0;
      return {
        playerId: p.playerId,
        nickname: p.nickname,
        taps,
        valorPujado: taps * this.state.valorPorTap,
        flagged: round.flaggedPlayers.has(p.playerId),
      };
    });
    rows.sort((a, b) => {
      if (b.taps !== a.taps) return b.taps - a.taps;
      const ta = round.firstReachedAt.get(a.playerId) ?? Infinity;
      const tb = round.firstReachedAt.get(b.playerId) ?? Infinity;
      return ta - tb; // quien llegó primero a ese conteo gana el desempate
    });
    return rows;
  }

  /** Posición (1-based) de cada jugador en un ranking ya ordenado, precalculada una sola vez. */
  private buildPositions(ranking: PlayerSummary[]): Map<string, number> {
    const positions = new Map<string, number>();
    ranking.forEach((r, i) => positions.set(r.playerId, i + 1));
    return positions;
  }

  buildPodium() {
    const totals = new Map<string, { adjudicados: number; valor: number; taps: number }>();
    for (const round of this.state.roundHistory) {
      for (const [playerId, taps] of round.counts.entries()) {
        const t = totals.get(playerId) ?? { adjudicados: 0, valor: 0, taps: 0 };
        t.taps += taps;
        if (round.ganador?.playerId === playerId) {
          t.adjudicados += 1;
          t.valor += round.ganador.valorFinal;
        }
        totals.set(playerId, t);
      }
    }
    const titulos = ["El Magnate Inmobiliario", "El Tiburón de los Bienes Raíces", "El Cazador de Ofertas"];
    const rows = [...totals.entries()]
      .map(([playerId, t]) => ({
        playerId,
        nickname: this.state.players.get(playerId)?.nickname ?? "?",
        inmueblesAdjudicados: t.adjudicados,
        valorTotal: t.valor,
        tapsAcumulados: t.taps,
      }))
      .sort((a, b) => b.inmueblesAdjudicados - a.inmueblesAdjudicados || b.valorTotal - a.valorTotal || b.tapsAcumulados - a.tapsAcumulados)
      .map((r, i) => ({ ...r, titulo: titulos[i] }));

    for (const s of this.state.screens) {
      safeSend(s, { t: "podium", top3: rows.slice(0, 3), portafolios: rows });
    }
    return rows;
  }

  // ---------- Broadcasts ----------

  // "Puja actual" del inmueble en pantalla: arranca en el avaluo y sube un
  // poco con cada toque aceptado (solo efecto visual/de tension -- el
  // ganador de la ronda lo sigue decidiendo quien mas toco, no este numero).
  private calcularPujaActual(avaluo: number, tapsTotales: number): number {
    const incremento = avaluo * GAME_CONSTANTS.PUJA_INCREMENTO_PCT_POR_TAP * tapsTotales;
    const techo = avaluo * GAME_CONSTANTS.PUJA_TECHO_MULT;
    return Math.min(avaluo + incremento, techo);
  }

  private broadcastTick() {
    const round = this.state.currentRound;
    if (!round || round.estado !== "running") return;
    const remainingMs = Math.max(0, round.startAt + round.duracionMs - this.now());
    const ranking = this.rankRound(round);
    const positions = this.buildPositions(ranking);
    const lider = ranking.length > 0 && ranking[0].taps > 0 ? { nickname: ranking[0].nickname, taps: ranking[0].taps } : null;

    for (const p of this.state.players.values()) {
      const misTaps = round.counts.get(p.playerId) ?? 0;
      const miPosicion = positions.get(p.playerId) ?? ranking.length + 1;
      safeSend(p.socket, {
        t: "tick",
        roundId: round.roundId,
        remainingMs,
        misTaps,
        miPosicion,
        valorActual: misTaps * this.state.valorPorTap,
        lider,
      });
    }

    const tapsTotales = [...round.counts.values()].reduce((a, b) => a + b, 0);
    const top5 = ranking.slice(0, 5);
    const payload = {
      t: "tick" as const,
      roundId: round.roundId,
      remainingMs,
      top5,
      tapsTotales,
      valorActual: tapsTotales * this.state.valorPorTap,
      pujaActual: this.calcularPujaActual(round.propiedad.avaluo, tapsTotales),
    };
    for (const s of this.state.screens) safeSend(s, payload);

    const hostPayload = {
      t: "host:tick" as const,
      roundId: round.roundId,
      remainingMs,
      top: ranking.slice(0, 10),
      tapsTotales,
      valorActual: tapsTotales * this.state.valorPorTap,
      pujaActual: this.calcularPujaActual(round.propiedad.avaluo, tapsTotales),
    };
    for (const h of this.state.hosts) safeSend(h, hostPayload);
  }

  broadcastLobby() {
    const payload = {
      t: "lobby" as const,
      pin: this.state.pin,
      qrUrl: `/play?pin=${this.state.pin}`,
      jugadores: [...this.state.players.values()].map((p) => ({ playerId: p.playerId, nickname: p.nickname })),
    };
    for (const s of this.state.screens) safeSend(s, payload);
  }

  broadcastHostState() {
    const payload = {
      t: "host:state" as const,
      estado: this.state.estado,
      pin: this.state.pin,
      properties: this.state.properties,
      jugadores: [...this.state.players.values()].map((p) => ({
        playerId: p.playerId,
        nickname: p.nickname,
        telefono: p.telefono,
        correo: p.correo,
        conectado: p.socket !== null,
        flagged: this.state.currentRound?.flaggedPlayers.has(p.playerId) ?? false,
      })),
      rondaActual: this.state.currentRound
        ? {
            roundId: this.state.currentRound.roundId,
            propiedad: this.state.currentRound.propiedad,
            estado: this.state.currentRound.estado,
            ganador: this.state.currentRound.ganador,
          }
        : null,
      historial: this.state.historial,
    };
    for (const h of this.state.hosts) safeSend(h, payload);
  }
}
