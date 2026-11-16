-- =============================================================================
-- 0020 · Rol reclutador_caleta (valor de enum)
--
-- En su propio archivo a propósito: PostgreSQL no permite usar un valor de enum
-- nuevo en la misma transacción en que se agrega. El acceso (funciones y RLS)
-- va en la migración siguiente.
-- =============================================================================

alter type public.app_role add value if not exists 'reclutador_caleta';
