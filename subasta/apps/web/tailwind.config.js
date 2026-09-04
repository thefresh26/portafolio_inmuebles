/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Paleta tomada directo del portafolio publico
        // (portafolio_inmuebles/index.html: --navy-900, --sky-500,
        // --amber-500, --text-on-navy), para que el juego y el portafolio
        // se vean como una sola familia visual.
        archivo: "#0b2a4a", // --navy-900 — fondo principal
        navy3: "#173f70", // --navy-700 — superficies secundarias
        manila: "#eaf1fb", // --text-on-navy — texto/tarjetas claras sobre fondo oscuro
        sello: "#E03535", // rojo — alertas, sello de "adjudicado" (sin equivalente en el portafolio)
        esmeralda: "#1AB87A", // verde — estados positivos (sin equivalente en el portafolio)
        oro: "#f5a623", // --amber-500 — acento principal
        azul: "#1aa8dd", // --sky-500 — acento secundario
      },
      fontFamily: {
        // Misma tipografia que portafolio_inmuebles/index.html.
        display: ["Poppins", "system-ui", "sans-serif"],
        body: ["Poppins", "system-ui", "sans-serif"],
        mono: ["'Courier New'", "monospace"],
      },
    },
  },
  plugins: [],
};
