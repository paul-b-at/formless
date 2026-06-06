import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Formless — Notarity Booking Assistant",
  description: "AI-powered notarity booking assistant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
