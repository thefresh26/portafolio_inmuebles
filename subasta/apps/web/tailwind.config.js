/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Paleta tomada del sistema comercial de Activos por Colombia
        // (navy/dorado corporativo), para que el juego se vea de la misma
        // familia visual que el resto de las herramientas internas.
        archivo: "#0D1F3C", // navy — fondo principal
        navy3: "#1E3A68", // navy claro — superficies secundarias
        manila: "#F4F6FA", // "off" — tarjetas claras / texto sobre fondo oscuro
        sello: "#E03535", // rojo corporativo — alertas, sello de "adjudicado"
        esmeralda: "#1AB87A", // verde corporativo — estados positivos
        oro: "#F5A800", // amarillo/dorado corporativo — acento principal
        azul: "#1A5BBF", // azul corporativo — acento secundario
      },
      fontFamily: {
        display: ["Montserrat", "system-ui", "sans-serif"],
        body: ["Open Sans", "system-ui", "sans-serif"],
        mono: ["'Courier New'", "monospace"],
      },
    },
  },
  plugins: [],
};
