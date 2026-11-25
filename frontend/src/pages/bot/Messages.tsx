import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Image as ImageIcon, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BotPage } from '@/components/BotShell'
import { SaveBar } from '@/components/page'
import { TelegramPreview, telegramHtml } from '@/components/telegram'
import { Button, Card, Textarea } from '@/components/ui'
import { PhotoButtons, useMessagePhoto } from '@/components/MessagePhoto'
import { panel, type BotCopy, type CopyItem } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApplyConfirmation } from '@/lib/applied'
import { examples, useBotCopy } from '@/lib/copy'

const effective = (item: CopyItem) => item.value ?? item.default

// Подпись к фото в Telegram — не больше 1024 символов: длиннее бот
// отправит сообщение без картинки (см. bot/app/ui.py).
const MAX_CAPTION = 1024

/** Подстановки и значки, которых нет у этого сообщения, — бот показал бы их
 *  клиенту как есть. Ловим сразу при наборе, а не при сохранении. */
function unknownPlaceholders(text: string, item: CopyItem, icons: Record<string, string>) {
  const allowed = new Set(item.variables.map((v) => v.name))
  const bad = new Set<string>()
  for (const match of text.matchAll(/\{(@?[A-Za-z_]+)\}/g)) {
    const name = match[1]
    if (name.startsWith('@') ? !(name.slice(1) in icons) : !allowed.has(name)) bad.add(`{${name}}`)
  }
  return [...bad]
}

function Editor({ copy }: { copy: BotCopy }) {
  const queryClient = useQueryClient()
  const items = copy.messages
  const [selected, setSelected] = useState(items[0]?.key ?? '')
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((i) => [i.key, effective(i)])),
  )
  const [savedAt, setSavedAt] = useState<number>()
  const { applied, begin } = useApplyConfirmation()
  const area = useRef<HTMLTextAreaElement>(null)

  const serverState = useMemo(
    () => Object.fromEntries(items.map((i) => [i.key, effective(i)])),
    [items],
  )
  // Зависимость — сами тексты, а не массив целиком: загрузка фото меняет
  // объекты в кэше, и черновик незавершённой правки иначе сбрасывался бы.
  const serverSignature = items
    .map((i) => `${i.key}\u0000${effective(i)}`)
    .join('\u0001')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDrafts(serverState), [serverSignature])

  const item = items.find((i) => i.key === selected) ?? items[0]
  const text = drafts[item.key] ?? ''
  const photo = useMessagePhoto(item.key)
  const changed = (i: CopyItem) => (drafts[i.key] ?? '').trim() !== i.default.trim()
  const dirty = items.some((i) => (drafts[i.key] ?? '') !== serverState[i.key])

  const save = useMutation({
    mutationFn: () => panel.saveBotTexts(drafts),
    onSuccess: (data) => {
      queryClient.setQueryData(['bot-copy'], data)
      setSavedAt(Date.now())
      begin()
    },
  })

  const setText = (value: string) => {
    save.reset()
    setDrafts((d) => ({ ...d, [item.key]: value }))
  }

  /** Вставка в позицию курсора; before/after оборачивают выделенное. */
  const insert = (before: string, after = '') => {
    const el = area.current
    if (!el) return setText(text + before + after)
    const { selectionStart: from, selectionEnd: to } = el
    const picked = text.slice(from, to)
    const next = text.slice(0, from) + before + picked + after + text.slice(to)
    setText(next)
    requestAnimationFrame(() => {
      el.focus()
      const caret = from + before.length + picked.length + (picked ? after.length : 0)
      el.setSelectionRange(picked ? caret : from + before.length, picked ? caret : from + before.length)
    })
  }

  const vars = examples(item)
  const html = telegramHtml(text, vars, copy.icons)
  const unknown = unknownPlaceholders(text, item, copy.icons)

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
        <nav className="space-y-1" aria-label="Сообщения бота">
          {items.map((i) => (
            <button
              key={i.key}
              type="button"
              onClick={() => setSelected(i.key)}
              className={cn(
                'flex w-full items-center gap-2 rounded-2xl border px-3 py-2 text-left text-sm transition-colors',
                i.key === item.key
                  ? 'border-accent/50 bg-accent/10 font-medium text-accent'
                  : 'border-transparent text-muted hover:bg-surface-hover hover:text-fg',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{i.title}</span>
              {i.photo_url && (
                <ImageIcon
                  className="size-3.5 shrink-0 text-muted"
                  aria-label="Своё фото"
                />
              )}
              {changed(i) && (
                <span className="size-2 shrink-0 rounded-full bg-accent" title="Свой текст" />
              )}
            </button>
          ))}
        </nav>

        <div className="space-y-4">
          <Card className="space-y-4">
            <div>
              <h2 className="font-medium">{item.title}</h2>
              <p className="mt-1 text-sm text-muted">{item.where}</p>
            </div>

            <div className="space-y-3 rounded-2xl border border-border/60 p-3">
              <p className="text-sm font-medium">Картинка сообщения</p>
              <p className="text-xs text-muted">
                Показывается над текстом этого сообщения. JPEG, PNG или WebP до 5 МБ.
                Применяется сразу. Без своей картинки — как на всех экранах, из блока
                «Картинка меню».
              </p>
              {item.photo_url ? (
                <img
                  src={item.photo_url}
                  alt="Картинка сообщения"
                  className="max-h-40 rounded-xl border object-contain"
                />
              ) : (
                <p className="text-xs text-muted">
                  Своей картинки нет — используется картинка меню.
                </p>
              )}
              {photo.error && <p className="text-sm text-danger">{photo.error}</p>}
              <PhotoButtons
                hasPhoto={Boolean(item.photo_url)}
                pending={photo.upload.isPending || photo.remove.isPending}
                onPick={(file) => photo.upload.mutate(file)}
                onRemove={() => photo.remove.mutate()}
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="mr-1 text-muted">Оформление:</span>
              {(
                [
                  ['Жирный', '<b>', '</b>'],
                  ['Курсив', '<i>', '</i>'],
                  ['Код', '<code>', '</code>'],
                ] as const
              ).map(([title, open, close]) => (
                <button
                  key={title}
                  type="button"
                  onClick={() => insert(open, close)}
                  className="rounded-full border border-border/60 px-3 py-1 hover:bg-surface-hover"
                >
                  {title}
                </button>
              ))}
            </div>

            <Textarea
              ref={area}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={9}
              className="font-mono text-[13px]"
              spellCheck={false}
            />

            {item.variables.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted">Подстановки — нажмите, чтобы вставить:</p>
                <div className="flex flex-wrap gap-1.5">
                  {item.variables.map((v) => (
                    <button
                      key={v.name}
                      type="button"
                      title={`${v.hint}, например: ${v.example}`}
                      onClick={() => insert(`{${v.name}}`)}
                      className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-accent hover:bg-accent/20"
                    >
                      {`{${v.name}}`}
                      <span className="ml-1.5 text-muted">{v.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-xs text-muted">Значки (у клиентов с премиум-эмодзи они анимированные):</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(copy.icons).map(([name, emoji]) => (
                  <button
                    key={name}
                    type="button"
                    title={`{@${name}}`}
                    onClick={() => insert(`{@${name}}`)}
                    className="size-8 rounded-xl border border-border/60 text-base hover:bg-surface-hover"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            {text.length > MAX_CAPTION && (
              <p className="rounded-2xl bg-warning/10 px-3 py-2 text-sm text-warning">
                Текст длиннее {MAX_CAPTION} символов — в подпись к фото он не влезет, и бот
                отправит сообщение без картинки.
              </p>
            )}

            {unknown.length > 0 && (
              <p className="rounded-2xl bg-warning/10 px-3 py-2 text-sm text-warning">
                В тексте есть то, чего бот не знает: {unknown.join(', ')}. Клиент увидит это как есть
                — удалите или выберите из списка подстановок выше.
              </p>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted">
                Разметка Telegram: <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>,{' '}
                <code>&lt;code&gt;</code>, <code>&lt;a href=&quot;…&quot;&gt;</code>. Каждый тег нужно
                закрывать.
              </p>
              <Button
                variant="ghost"
                className="h-9 shrink-0"
                disabled={text.trim() === item.default.trim()}
                onClick={() => setText(item.default)}
              >
                <RotateCcw className="size-4" />
                Стандартный
              </Button>
            </div>
          </Card>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              Так увидит клиент (с примерами вместо подстановок)
            </p>
            <div className="max-w-md space-y-2">
              {item.photo_url && (
                <div className="overflow-hidden rounded-2xl border border-border/60">
                  <img
                    src={item.photo_url}
                    alt=""
                    className="max-h-64 w-full object-cover"
                  />
                </div>
              )}
              <TelegramPreview html={html} />
            </div>
          </div>
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        pending={save.isPending}
        error={save.isError ? (save.error as Error).message : null}
        savedAt={savedAt}
        applied={applied}
        onSave={() => save.mutate()}
        onReset={() => {
          save.reset()
          setDrafts(serverState)
        }}
      />
    </>
  )
}

export default function BotMessages() {
  return (
    <BotPage
      title="Тексты сообщений"
      description="Что бот пишет клиентам: список тарифов, подписка, напоминания, оплата. Слева выберите сообщение, справа правьте — превью меняется сразу."
      requireToken={false}
    >
      {() => <Loader />}
    </BotPage>
  )
}

function Loader() {
  const { data, isError, error } = useBotCopy()
  if (isError) return <p className="text-sm text-danger">{(error as Error).message}</p>
  if (!data) return <p className="text-sm text-muted">Загрузка…</p>
  return <Editor copy={data} />
}
