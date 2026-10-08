import { Route, Routes } from 'react-router-dom'
import AppLayout from '@/components/layout/AppLayout'
import Inicio from '@/pages/Inicio'
import Login from '@/pages/Login'
import MisTareas from '@/pages/MisTareas'
import NoEncontrado from '@/pages/NoEncontrado'
import Proyecto from '@/pages/Proyecto'
import Proyectos from '@/pages/Proyectos'
import Usuarios from '@/pages/Usuarios'

/**
 * Dos zonas:
 *   /login — publica
 *   /      — la app, dentro de AppLayout (exige sesion)
 *
 * Un solo nivel de usuario: no hay rutas por rol. Lo que cada uno ve de un
 * proyecto lo decide el backend (solo miembros), no el ruteo.
 *
 * /proyectos/:id/:vista — vista = lista | tablero. Sin vista, se usa la
 * ultima elegida. `?tarea=<id>` abre el panel de esa tarea (link compartible).
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route path="/" element={<AppLayout />}>
        <Route index element={<Inicio />} />
        <Route path="proyectos" element={<Proyectos />} />
        <Route path="proyectos/:id/:vista?" element={<Proyecto />} />
        <Route path="mis-tareas" element={<MisTareas />} />
        <Route path="usuarios" element={<Usuarios />} />
      </Route>

      <Route path="*" element={<NoEncontrado />} />
    </Routes>
  )
}
