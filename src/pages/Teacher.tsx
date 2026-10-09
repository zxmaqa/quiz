import { useParams } from 'react-router-dom'

export default function Teacher() {
  const { groupId } = useParams()
  return <h1 className="p-6 text-2xl font-bold">Teacher page — group {groupId}</h1>
}
