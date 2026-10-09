import { useParams } from 'react-router-dom'

export default function Student() {
  const { quizId } = useParams()
  return <h1 className="p-6 text-2xl font-bold">Student page — quiz {quizId}</h1>
}
