import { getAllAuthors } from "@/lib/queries";
import { siteConfig } from "@/lib/site-config";
import { AuthorCard } from "@/components/author/AuthorCard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `Our Team - ${siteConfig.title}`,
  description: `Meet the expert team behind ${siteConfig.title}.`,
};

export default async function TeamPage() {
  const allAuthors = await getAllAuthors();
  const authors = allAuthors.filter((a) => a.slug !== "team");

  return (
    <div className="authors-page">
      <section className="authors-banner">
        <h1>Our Team</h1>
        <p>Meet the professionals behind our content.</p>
      </section>
      <section className="authors-grid">
        {authors.map((author) => (
          <AuthorCard key={author.id} author={author} />
        ))}
      </section>
    </div>
  );
}
