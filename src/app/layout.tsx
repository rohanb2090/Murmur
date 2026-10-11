import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/instrument-sans';
import './globals.css';
import { ServiceWorker } from '@/components/ServiceWorker';
import { Toaster } from '@/components/Toaster';

export const metadata: Metadata = {
  title: 'Murmur',
  description: 'Say it, snap it or type it. Split shared expenses and settle up over UPI.',
  applicationName: 'Murmur',
  appleWebApp: { capable: true, title: 'Murmur', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f3f9' },
    { media: '(prefers-color-scheme: dark)', color: '#15183a' },
  ],
};

// Set the theme before first paint so there's no flash.
const themeScript = `(function(){try{var t=localStorage.getItem('murmur-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        {children}
        <Toaster />
        <ServiceWorker />
      </body>
    </html>
  );
}
