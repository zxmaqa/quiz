import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import Manager from './pages/Manager'
import Results from './pages/Results'
import Student from './pages/Student'
import Teacher from './pages/Teacher'

const DEMO_GROUP_ID = '11111111-1111-4111-8111-111111111111'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to={`/t/${DEMO_GROUP_ID}`} replace />} />
        <Route path="/t/:groupId" element={<Teacher />} />
        <Route path="/t/:groupId/r/:quizId" element={<Results />} />
        <Route path="/q/:quizId" element={<Student />} />
        <Route path="/m" element={<Manager />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
