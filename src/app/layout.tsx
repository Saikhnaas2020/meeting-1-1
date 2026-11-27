import type { Metadata, Viewport } from "next"
import "./styles.css"

export const metadata: Metadata = {
  title: "My 1:1 Meeting",
  description: "Ажилтан, удирдлага, HR-ын 1:1 уулзалтын апп",
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#6f8cf5" }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="mn">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Montserrat:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
