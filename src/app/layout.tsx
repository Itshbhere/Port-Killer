import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Port Killer — Local Port Inspector & Process Terminator",
  description: "Inspect active local ports, detect occupied sockets, and terminate rogue processes with one click.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans bg-slate-950 text-slate-100 min-h-full antialiased selection:bg-rose-500 selection:text-white`}
      >
        {children}
      </body>
    </html>
  );
}
