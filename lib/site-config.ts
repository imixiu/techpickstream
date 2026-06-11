export const siteConfig = {
  name: "techpickstream",
  shortTitle: "TechPickStream",
  title: "TechPickStream — Consumer Electronics Reviews, News & Buying Guides",
  description: "Expert reviews, in-depth comparisons, and buying guides for smartphones, audio gear, wearables, smart home devices, laptops, and gaming tech.",
  tagline: "Your Stream of Smart Tech Picks",
  url: "https://techpickstream.com",
  ogImage: "https://9bwbxubcyu3vbaiq.public.blob.vercel-storage.com/homepage/techpickstream/og-image-IsMP6ts9FKnm6xubrar6oT5dFMgdzI.png",
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
  ] as { key: string; label: string; description: string }[],
};
