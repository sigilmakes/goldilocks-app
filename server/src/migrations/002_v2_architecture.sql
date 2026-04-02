-- V2 architecture: pi session ID mapping, drop dead tables

-- Add pi_session_id to conversations for mapping to pi's internal sessions
ALTER TABLE conversations ADD COLUMN pi_session_id TEXT;

-- Add last_message_preview for sidebar display without hitting the pod
ALTER TABLE conversations ADD COLUMN last_message_preview TEXT;

-- Drop structure_library — structures live on user PVC now
DROP TABLE IF EXISTS structure_library;
