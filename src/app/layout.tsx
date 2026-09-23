import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = { title: 'Care360 Signal | Homecare operations', description: 'Auditable homecare reporting and clinical escalation review' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
