import Link from "next/link";
import { siteConfig } from "@/lib/site-config";

export function Header() {
  return (
    <header className="site-header">
      <Link href="/" className="logo">
        Tech<span style={{ color: '#06b6d4', WebkitTextFillColor: '#06b6d4' }}>Pick</span>Stream
      </Link>
      <nav className="main-nav">
        {siteConfig.categories.map((cat) => (
          <Link key={cat.key} href={`/${cat.key}`}>
            {cat.label}
          </Link>
        ))}
        <Link href="/author/team">Authors</Link>
      </nav>
    </header>
  );
}
