import "./globals.css";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DreamVision — 2D Fluid Simulation",
  description:
    "Interactive real-time 2D fluid dynamics simulation based on the Navier-Stokes equations.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
