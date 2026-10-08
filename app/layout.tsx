import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: siteConfig.title,
  description: siteConfig.description,
  alternates: {
    canonical: siteConfig.url,
  },
  openGraph: {
    title: siteConfig.title,
    description: siteConfig.description,
    url: siteConfig.url,
    type: "website",
    images: siteConfig.ogImage
      ? [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: siteConfig.title }]
      : [],
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.title,
    description: siteConfig.description,
    images: siteConfig.ogImage ? [siteConfig.ogImage] : [],
  },
};

const webSiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: siteConfig.title,
  url: siteConfig.url,
  description: siteConfig.description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-95PY8PSZ0Y"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-95PY8PSZ0Y', {
              'send_page_view': true
            });
            // Engagement timer: fires after 10s to count as engaged session
            setTimeout(function() {
              gtag('event', 'engagement_timer', {
                'event_category': 'engagement',
                'event_label': '10s_stay',
                'non_interaction': false
              });
            }, 10000);
            // Scroll engagement event
            var scrollFired = false;
            window.addEventListener('scroll', function() {
              if (!scrollFired && window.scrollY > 300) {
                scrollFired = true;
                gtag('event', 'scroll_depth', {
                  'event_category': 'engagement',
                  'event_label': 'scrolled_300px',
                  'non_interaction': false
                });
              }
            });
          `}
        </Script>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteJsonLd) }}
        />
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
