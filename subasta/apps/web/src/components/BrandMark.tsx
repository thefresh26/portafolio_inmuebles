/**
 * Marca gráfica de Activos por Colombia: el ícono oficial (logo.png), para
 * que Subasta Activa se vea de la misma familia visual que las demás
 * herramientas internas.
 */
export default function BrandMark({ className = "w-10 h-10" }: { className?: string }) {
  return <img src="/logo.png" alt="Activos por Colombia" className={`${className} rounded-lg`} />;
}
