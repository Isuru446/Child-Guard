\set ON_ERROR_STOP on
\echo 'WP00-B BLOCKED: historical original-target provisioning. Do not invoke psql with this file; V2 roles require separate approval.'
\quit
-- Historical SQL retained below; unreachable through psql script execution.
-- Run only with PostgreSQL 18 psql, using a privately authenticated administrator.
-- Refuse existing databases/roles rather than replacing unknown records or grants.
DO $$
BEGIN
 IF current_database() <> 'postgres'
    OR inet_server_addr() IS DISTINCT FROM inet '127.0.0.1'
    OR inet_server_port() IS DISTINCT FROM 5432
    OR current_setting('server_version_num')::int NOT BETWEEN 180000 AND 189999 THEN
  RAISE EXCEPTION 'Expected local PostgreSQL 18 administrator connection to postgres on 127.0.0.1:5432';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_database WHERE datname = 'childguard_test') THEN
  RAISE EXCEPTION 'childguard_test already exists. Inspect it independently; nothing will be dropped or overwritten';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'childguard_test_app') THEN
  RAISE EXCEPTION 'Test role already exists. Inspect its ownership and grants before any manual continuation';
 END IF;
END $$;

CREATE ROLE childguard_test_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
-- psql prompts twice without echoing or saving a plaintext password in this file.
\password childguard_test_app
CREATE DATABASE childguard_test OWNER childguard_test_app TEMPLATE template0;
\echo 'Created dedicated test database and owner. No restored application records copied.'
