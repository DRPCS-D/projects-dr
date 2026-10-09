-- Primer administrador de Proyectos DR.
--
-- Nadie puede darse de alta solo (las cuentas las crea un admin desde la app),
-- asi que el PRIMER admin se crea a mano:
--
--   1. Supabase → Authentication → Users → Add user → Create new user
--      (tu email y una contraseña, con "Auto Confirm User" marcado).
--   2. Cambiar el email y el nombre de abajo y correr este archivo en el SQL Editor.
--
-- Es idempotente: si ya existe la fila en `usuarios`, la deja como admin activo.
-- Desde ahi, los demas usuarios se crean desde la app (menu "Usuarios").

insert into public.usuarios (id, nombre, email, rol, activo)
select u.id, 'TU NOMBRE', lower(u.email), 'admin', true
from auth.users u
where lower(u.email) = lower('tu-email@ejemplo.com')
on conflict (id) do update set rol = 'admin', activo = true;

-- Debe devolver 1 fila. Si devuelve 0, el email no coincide con el de Auth.
select id, nombre, email, rol, activo from public.usuarios where rol = 'admin';
