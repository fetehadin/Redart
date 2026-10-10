import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Redart — reading ledger",
    short_name: "Redart",
    description: "Plan your reading, tick off articles, keep a note on each.",
    start_url: "/",
    display: "standalone",
    background_color: "#eef1ec",
    theme_color: "#1d3557",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
