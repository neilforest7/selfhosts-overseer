-- Manually created migration to add the missing unique constraint to ReverseProxyRoute

ALTER TABLE "ReverseProxyRoute" ADD CONSTRAINT "ReverseProxyRoute_hostId_domain_key" UNIQUE ("hostId", "domain");
