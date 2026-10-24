import type React from "react"
import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"

const _geist = Geist({ subsets: ["latin"] })
const _geistMono = Geist_Mono({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "SolarWatch AI — Solar Farm Intelligence Platform",
  description:
    "Real-time AI-powered solar panel monitoring, defect detection, and maintenance dispatch for smart solar farm management.",
  generator: "SolarWatch AI",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0B0C0F",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="bg-[#0B0C0F] dark">
      <body className={`font-sans antialiased bg-[#0B0C0F]`}>
        {children}
      </body>
    </html>
  )
}
