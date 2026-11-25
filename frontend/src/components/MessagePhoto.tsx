import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui'
import { panel } from '@/lib/api'

/** Загрузка и снятие фото у одного сообщения.
 *
 *  Фото применяется сразу, как картинка меню: сервер кладёт файл в общий
 *  том и возвращает обновлённый реестр текстов, который кладём в кэш.
 */
export function useMessagePhoto(key: string) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const apply = (data: unknown) => queryClient.setQueryData(['bot-copy'], data)

  const upload = useMutation({
    mutationFn: (file: File) => panel.setBotTextPhoto(key, file),
    onSuccess: (data) => {
      setError(null)
      apply(data)
    },
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: () => panel.deleteBotTextPhoto(key),
    onSuccess: (data) => {
      setError(null)
      apply(data)
    },
    onError: (e: Error) => setError(e.message),
  })

  return { upload, remove, error, setError }
}

/** Кнопки «Загрузить/Заменить» и «Убрать» — тем же видом, что у меню. */
export function PhotoButtons({
  hasPhoto,
  pending,
  onPick,
  onRemove,
}: {
  hasPhoto: boolean
  pending: boolean
  onPick: (file: File) => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="cursor-pointer rounded-full bg-accent focus-within:ring-2 focus-within:ring-accent/40">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) onPick(file)
          }}
        />
        <span className="inline-flex h-10 items-center gap-2 px-5 text-sm font-medium text-accent-fg">
          <ImagePlus className="size-4" />
          {pending ? 'Загружаю…' : hasPhoto ? 'Заменить' : 'Загрузить'}
        </span>
      </label>
      {hasPhoto && (
        <Button variant="ghost" className="h-10" onClick={onRemove} disabled={pending}>
          <Trash2 className="size-4" />
          Убрать
        </Button>
      )}
    </div>
  )
}
