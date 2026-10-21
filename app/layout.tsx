import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from 'sonner'
import { HLSConfigProvider } from '@/components/hls-config-provider'
import { ConditionalLayout } from '@/components/conditional-layout'
import { NavbarProvider } from '@/contexts/NavbarContext'
import { PremiumScrollbar } from '@/components/premium-scrollbar'

const inter = Inter({ subsets: ['latin'] })

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    themeColor: '#000000',
}

export const metadata: Metadata = {
  title: 'TheHustlePlace - Streaming Premium',
  description: 'La piattaforma di streaming più elegante e moderna. Guarda film e serie TV in alta qualità.',
  keywords: 'streaming, film, serie tv, entertainment, premium',
  authors: [{ name: 'TheHustlePlace Team' }],
  openGraph: {
    title: 'TheHustlePlace - Streaming Premium',
    description: 'La piattaforma di streaming più elegante e moderna',
    type: 'website',
    locale: 'it_IT',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TheHustlePlace - Streaming Premium',
    description: 'La piattaforma di streaming più elegante e moderna',
  },
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="it" className="dark">
      <head>
        {/* CSS critico spostato in globals.css per evitare hydration mismatch */}
        <script src="https://www.youtube.com/iframe_api" async></script>
      </head>
      <body className={inter.className} suppressHydrationWarning={true}>
        <HLSConfigProvider>
          <NavbarProvider>
            <div className="min-h-screen bg-black text-white">
              <ConditionalLayout>
                {children}
              </ConditionalLayout>
            </div>
            <Toaster theme="dark" position="bottom-right" closeButton richColors />
            <PremiumScrollbar />
          </NavbarProvider>
        </HLSConfigProvider>
      </body>
    </html>
  )
}
