/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The browser calls same-origin `/wisper/*`; Next proxies to the Wisper API so
  // there is no CORS. Point WISPER_API_URL at your Wisper host (see .env.example).
  async rewrites() {
    const target = process.env.WISPER_API_URL || "http://localhost:8080";
    return [{ source: "/wisper/:path*", destination: `${target}/:path*` }];
  },
};

export default nextConfig;
