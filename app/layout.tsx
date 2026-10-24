import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Support chat",
  description: "A simple support ticket chat.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="topnav">
          <a href="/">Chat</a>
          <a href="/triage">Triage</a>
          <a href="/smoke">Smoke test</a>
          <a href="/admin">Admin</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
