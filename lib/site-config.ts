export const siteConfig = {
  name: "techpickstream",
  shortTitle: "TechPickStream",
  title: "TechPickStream — Consumer Electronics Reviews, News & Buying Guides",
  description: "Expert reviews, in-depth comparisons, and buying guides for smartphones, audio gear, wearables, smart home devices, laptops, and gaming tech.",
  tagline: "Your Stream of Smart Tech Picks",
  url: "https://techpickstream.com",
  ogImage: "https://s.alicdn.com/@sc02/kf/A761cc8cee43244d9973382fbb6c5bfea6.jpg",
  colors: {
    primary: "#6366f1",
    primaryDark: "#4f46e5",
    secondary: "#8b5cf6",
    accent: "#06b6d4",
  },
  categories: [
    { key: "smartphones", label: "Smartphones & Mobile", description: "Latest smartphone reviews, comparisons, and mobile tech news covering flagship and budget devices." },
    { key: "audio-gear", label: "Audio & Sound", description: "Headphones, earbuds, speakers, and audio equipment reviews for audiophiles and casual listeners." },
    { key: "wearables", label: "Wearables & Smartwatches", description: "Smartwatch reviews, fitness tracker comparisons, and wearable technology guides." },
    { key: "smart-home", label: "Smart Home & IoT", description: "Smart home device reviews, home automation guides, and IoT product recommendations." },
    { key: "laptops-tablets", label: "Laptops & Tablets", description: "Laptop and tablet reviews for productivity, creativity, and everyday use across all price ranges." },
    { key: "gaming", label: "Gaming & Entertainment", description: "Gaming hardware, consoles, peripherals, and home entertainment setup guides." },
    { key: "general", label: "General Tech", description: "General technology news, trends, guides, and product reviews across various tech categories." },
  ] as { key: string; label: string; description: string }[],
};
