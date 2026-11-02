import type { Metadata } from "next";
import { Inter, Bebas_Neue } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"] });
export const bebasNeue = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-bebas" });

export const metadata: Metadata = {
  title: "HomeTheater",
  description: "Watch together, feel together.",
  keywords: ["HomeTheater", "watch party", "shared viewing", "video streaming"],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "HomeTheater",
    description: "Watch movies and videos together with a shared viewing experience.",
    siteName: "HomeTheater",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "HomeTheater",
    description: "Watch movies and videos together with a shared viewing experience.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${bebasNeue.variable} bg-[#141414] text-white antialiased`}>
        {children}
      </body>
    </html>
  );
}
