import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "pdfkit", "@libsql/client"],
};

export default nextConfig;
