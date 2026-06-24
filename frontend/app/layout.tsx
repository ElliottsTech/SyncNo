import './globals.css';
import Providers from '../components/Providers';
import LayoutContent from '../components/LayoutContent';
import ActivityLogger from '../components/ActivityLogger';
import DemoBanner from '../components/DemoBanner';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Syncno',
  description: 'Syncro MSP Data Viewer',
  icons: {
    icon: '/SyncNo.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <DemoBanner />
          <ActivityLogger />
          <LayoutContent>{children}</LayoutContent>
        </Providers>
      </body>
    </html>
  );
}
