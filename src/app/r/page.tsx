'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMurmur } from '@/store/murmur';
import { isValidSlug } from '@/lib/id';
import { RoomScreen } from '@/components/RoomScreen';
import { JoinRoom } from '@/components/JoinRoom';

/**
 * Rooms live at /r#<slug>. The fragment never reaches a server, so room keys
 * stay out of hosting logs and one cached page serves every room offline.
 */
export default function RoomPage() {
  const router = useRouter();
  const [slug, setSlug] = useState<string | null>(null);
  const hydrated = useMurmur((s) => s.hydrated);
  const room = useMurmur((s) => (slug ? s.rooms[slug] : undefined));

  useEffect(() => {
    const read = () => {
      const s = decodeURIComponent(location.hash.replace(/^#/, ''));
      if (!isValidSlug(s)) router.replace('/');
      else setSlug(s);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [router]);

  if (!slug || !hydrated) return <main className="min-h-dvh" aria-busy="true" />;
  if (room) return <RoomScreen room={room} />;
  return <JoinRoom slug={slug} />;
}
