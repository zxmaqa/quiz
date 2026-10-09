import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Quiz = { id: string; title: string; status: string }

export default function Teacher() {
  const { groupId } = useParams()
  const [quizzes, setQuizzes] = useState<Quiz[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    supabase
      .from('quizzes')
      .select('id,title,status')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setFailed(true)
        else setQuizzes(data as Quiz[])
      })
  }, [groupId])

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <h1 className="text-2xl font-bold">Quizlər</h1>
      {failed && <p className="text-red-600">Xəta baş verdi. Səhifəni yeniləyin.</p>}
      {!failed && quizzes === null && <p>Yüklənir…</p>}
      {quizzes?.length === 0 && <p>Bu qrupda quiz yoxdur.</p>}
      {quizzes?.map((quiz) => {
        const link = `${window.location.origin}/q/${quiz.id}`
        return (
          <section key={quiz.id} className="space-y-3 rounded-xl border border-gray-300 p-4">
            <h2 className="text-lg font-semibold">{quiz.title}</h2>
            <p className="text-sm text-gray-600">
              Status: {quiz.status === 'live' ? 'Aktiv' : 'Qaralama'}
            </p>
            {quiz.status === 'live' && (
              <div className="space-y-2">
                <p className="text-sm">Şagird linki:</p>
                <a href={link} className="break-all text-blue-700 underline">
                  {link}
                </a>
                <div className="inline-block rounded-lg bg-white p-3">
                  <QRCodeSVG value={link} size={176} />
                </div>
              </div>
            )}
            <Link
              to={`/t/${groupId}/r/${quiz.id}`}
              className="block rounded-lg bg-blue-700 px-4 py-3 text-center font-semibold text-white"
            >
              Nəticələr
            </Link>
          </section>
        )
      })}
    </main>
  )
}
