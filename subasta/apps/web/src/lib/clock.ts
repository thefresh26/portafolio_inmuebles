/**
 * Estima el offset entre el reloj local y el del servidor a partir de
 * muestras ping/pong { t0 (enviado), t1 (respondido por el servidor) }.
 * offset = tServidor - tLocal, usando la mediana de varias muestras (plan 2.3).
 */
export class ServerClock {
  private samples: number[] = [];
  offset = 0;

  addSample(t0: number, t1: number) {
    const now = Date.now();
    const rtt = now - t0;
    const estimatedServerNow = t1 + rtt / 2;
    this.samples.push(estimatedServerNow - now);
    if (this.samples.length >= 3) {
      const sorted = [...this.samples].sort((a, b) => a - b);
      this.offset = sorted[Math.floor(sorted.length / 2)];
    }
  }

  now() {
    return Date.now() + this.offset;
  }
}
