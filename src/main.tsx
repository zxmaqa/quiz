import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import Manager from './pages/Manager'
import Student from './pages/Student'
import Teacher from './pages/Teacher'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/t/:groupId" element={<Teacher />} />
        <Route path="/q/:quizId" element={<Student />} />
        <Route path="/m" element={<Manager />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
