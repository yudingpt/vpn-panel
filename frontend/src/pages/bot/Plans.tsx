import { BotPage } from '@/components/BotShell'
import BotPlans from '../BotPlans'
import BotTraffic from '../BotTraffic'

export default function BotPlansPage() {
  return (
    <BotPage
      title="Тарифы"
      description="Что и за сколько продаёт бот: тарифы, общая скидка и пакеты трафика. Изменения видны клиентам сразу."
    >
      {() => (
        <>
          <BotPlans />
          <BotTraffic />
        </>
      )}
    </BotPage>
  )
}
