import { INDEX_HTML } from "@/lib/index-html";

export async function GET() {
  return new Response(INDEX_HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
