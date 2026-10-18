/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets a production build use a separate output folder so it never collides
  // with a running `next dev` server that owns `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next"
};

export default nextConfig;
