/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['http://192.168.31.7:3000'],
  outputFileTracingRoot: '/opt/selfhost-serv-agent',
  output: 'standalone',
  typescript: {
    // Force regeneration of type files
    ignoreBuildErrors: false,
  },
    async rewrites() {
    return [
      {
        source: '/api/:path*',
        // Forward API to backend inside the same container
        destination: 'http://127.0.0.1:3001/api/:path*',
      },
    ];
  },
  webpack: (config, { isServer }) => {
    // Handle node: protocol imports
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        child_process: false,
        crypto: false,
        path: false,
        os: false,
        stream: false,
        buffer: false,
        util: false,
        assert: false,
      };
    }


    return config;
  },
  serverExternalPackages: ['bcryptjs'],
};

module.exports = nextConfig;

