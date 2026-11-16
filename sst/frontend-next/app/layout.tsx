import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "SGSST | Gestión", description: "Gestión de reportes y acciones de seguridad y salud en el trabajo" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="es"><body>{children}</body></html>; }
