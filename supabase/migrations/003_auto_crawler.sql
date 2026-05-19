-- Migration: Add crawler authentication fields to projects
alter table projects
  add column auth_login_url text,
  add column auth_username text,
  add column auth_password text;
