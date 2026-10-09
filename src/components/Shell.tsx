import { Link, Route, Routes, useLocation } from 'react-router-dom'
import Guide from '../pages/Guide'
import Manager from '../pages/Manager'
import Results from '../pages/Results'
import Student from '../pages/Student'
import Teacher from '../pages/Teacher'

// "← Bələdçi" at the top of every page except the guide itself. Student pages use the narrow column.
export default function Shell() {
  const { pathname } = useLocation()
  const narrow = pathname.startsWith('/q/')
  return (
    <>
      {pathname !== '/' && (
        <nav className={`mx-auto px-4 pt-3 ${narrow ? 'max-w-[480px]' : 'max-w-[1024px]'}`}>
          <Link to="/" className="inline-flex min-h-12 items-center text-primary underline underline-offset-4">
            ← Bələdçi
          </Link>
        </nav>
      )}
      <Routes>
        <Route path="/" element={<Guide />} />
        <Route path="/t/:groupId" element={<Teacher />} />
        <Route path="/t/:groupId/r/:quizId" element={<Results />} />
        <Route path="/q/:quizId" element={<Student />} />
        <Route path="/m" element={<Manager />} />
      </Routes>
    </>
  )
}
