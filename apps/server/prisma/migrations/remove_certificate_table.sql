-- Migration: Remove Certificate Table
-- This migration removes the Certificate table and all its data
-- Run this when the database is available

-- Drop the Certificate table
DROP TABLE IF EXISTS "Certificate";

-- Note: We are NOT removing certificate-related fields from ReverseProxyRoute
-- as requested to preserve existing functionality