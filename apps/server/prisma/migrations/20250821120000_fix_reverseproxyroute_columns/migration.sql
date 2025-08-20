-- Manually created migration to add missing columns to ReverseProxyRoute

ALTER TABLE "ReverseProxyRoute"
ADD COLUMN "sslForced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "hstsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "hstsSubdomains" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "http2Support" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "allowWebsocketUpgrade" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "blockExploits" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "cachingEnabled" BOOLEAN NOT NULL DEFAULT false;
