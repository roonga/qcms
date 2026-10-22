-- Every QCMS role that is not a superuser. A superuser holds every privilege on every
-- object by definition rather than by a grant, so its rows would say nothing about the
-- grant model and would outnumber the ones that do. The bootstrap credential
-- (`QCMS_DB_USER`, `qcms` by default) matches the prefix and is one.
with qcms as (select rolname from pg_roles where rolname like 'qcms%' and not rolsuper),
     schemas as (
       select n.oid, n.nspname
         from pg_catalog.pg_namespace n
        where n.nspname not like 'pg\_%'
          and n.nspname <> 'information_schema'
          and not (n.nspname = any($1))
     ),
     relations as (
       select s.nspname, c.relname, c.oid, c.relkind
         from pg_catalog.pg_class c join schemas s on s.oid = c.relnamespace
        where c.relkind in ('r', 'p', 'v', 'm', 'S')
     )
select line from (
  -- Tables, views and materialised views: the seven table privileges.
  select format('relation %s.%s %s %s', r.nspname, r.relname, q.rolname, p.privilege) as line
    from relations r
    cross join qcms q
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                       ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(privilege)
   where r.relkind <> 'S' and has_table_privilege(q.rolname, r.oid, p.privilege)
  union all
  -- Sequences take their own three, and `has_table_privilege` raises on them.
  select format('sequence %s.%s %s %s', r.nspname, r.relname, q.rolname, p.privilege) as line
    from relations r
    cross join qcms q
    cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) as p(privilege)
   where r.relkind = 'S' and has_sequence_privilege(q.rolname, r.oid, p.privilege)
  union all
  -- Column-level privileges, listed only where the table does not already carry the same
  -- one, so the map is not every table grant repeated once per column.
  select format('column %s.%s.%s %s %s', s.nspname, c.relname, a.attname, q.rolname, p.privilege) as line
    from relations c
    join schemas s on s.nspname = c.nspname
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join qcms q
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) as p(privilege)
   where c.relkind <> 'S'
     and has_column_privilege(q.rolname, c.oid, a.attnum, p.privilege)
     and not has_table_privilege(q.rolname, c.oid, p.privilege)
  union all
  select format('function %s.%s(%s) %s EXECUTE', s.nspname, f.proname,
                pg_get_function_identity_arguments(f.oid), q.rolname) as line
    from pg_catalog.pg_proc f
    join schemas s on s.oid = f.pronamespace
    cross join qcms q
   where has_function_privilege(q.rolname, f.oid, 'EXECUTE')
  union all
  select format('type %s.%s %s USAGE', s.nspname, t.typname, q.rolname) as line
    from pg_catalog.pg_type t
    join schemas s on s.oid = t.typnamespace
    cross join qcms q
   where t.typtype = 'e' and has_type_privilege(q.rolname, t.oid, 'USAGE')
  union all
  select format('schema %s %s %s', s.nspname, q.rolname, p.privilege) as line
    from schemas s
    cross join qcms q
    cross join (values ('USAGE'), ('CREATE')) as p(privilege)
   where has_schema_privilege(q.rolname, s.oid, p.privilege)
  union all
  -- No `has_*_privilege` form exists for either of the last two, so they stay on
  -- `aclexplode`. Both are empty today, which is why a future one would stand out.
  select format('default %s %s %s %s %s', coalesce(n.nspname, '-'), d.defaclobjtype,
                pg_get_userbyid(d.defaclrole), pg_get_userbyid(a.grantee), a.privilege_type) as line
    from pg_catalog.pg_default_acl d
    left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
   where pg_get_userbyid(a.grantee) like 'qcms%'
  union all
  select format('largeobject %s %s %s', l.oid, pg_get_userbyid(a.grantee), a.privilege_type) as line
    from pg_catalog.pg_largeobject_metadata l
    cross join lateral aclexplode(l.lomacl) a
   where pg_get_userbyid(a.grantee) like 'qcms%'
) lines order by line
