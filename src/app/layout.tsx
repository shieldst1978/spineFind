import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Nav } from "@/components/nav";
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
  title: "SpineFind",
  description: "Find films on the shelf by spine colour, and log every film watched.",
  // Name under the Home Screen icon. Not a standalone web app: the Microsoft
  // sign-in redirect works best inside ordinary Safari.
  appleWebApp: { title: "SpineFind" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Nav />
        {children}
        <footer className="mx-auto w-full max-w-5xl space-y-2 px-4 py-6 text-xs text-stone-500">
          <Link href="/settings" className="inline-block py-1 text-sm underline">Settings</Link>
          <p>
          Film data and posters from{" "}
          <a href="https://www.themoviedb.org" className="underline" target="_blank" rel="noreferrer">TMDB</a>.
          This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </footer>
      </body>
    </html>
  );
}
