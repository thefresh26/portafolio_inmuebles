import type { Property } from "@subasta/shared";

/**
 * Catálogo de respaldo: solo se usa si SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * no están configurados (modo desarrollo sin base de datos). En producción los
 * inmuebles se leen y administran desde la tabla `properties` de Supabase.
 */
export const PROPERTIES: Property[] = [
  {
    id: "prop-1",
    nombre: "Penthouse Bocagrande",
    ciudad: "Cartagena",
    tipo: "Apartamento",
    matriculaInmobiliaria: "060-123456",
    areaM2: 210,
    avaluo: 2_400_000_000,
    descripcion: "Penthouse con vista al mar, 4 alcobas, terraza privada.",
    estado: "disponible",
  },
  {
    id: "prop-2",
    nombre: "Casa Campestre La Ceja",
    ciudad: "La Ceja",
    tipo: "Casa",
    matriculaInmobiliaria: "060-654321",
    areaM2: 480,
    avaluo: 890_000_000,
    descripcion: "Casa campestre con lote de 2.000 m2, piscina y BBQ.",
    estado: "disponible",
  },
  {
    id: "prop-3",
    nombre: "Oficina Torre Empresarial",
    ciudad: "Bogotá",
    tipo: "Oficina",
    matriculaInmobiliaria: "050-998877",
    areaM2: 95,
    avaluo: 620_000_000,
    descripcion: "Oficina en piso 14, zona financiera, parqueadero incluido.",
    estado: "disponible",
  },
];
