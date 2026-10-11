import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Murmur — shared expenses',
    short_name: 'Murmur',
    description: 'Say it, snap it or type it. Split shared expenses and settle up over UPI.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#15183a',
    theme_color: '#15183a',
    categories: ['finance', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
