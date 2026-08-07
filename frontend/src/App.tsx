import { useState } from 'react'
import { TikTokIcon } from './components/ui/TikTokIcon'
import { ShopeeIcon } from './components/ui/ShopeeIcon'
import { TiktokFlow } from './TiktokFlow'
import { ShopeeFlow } from './ShopeeFlow'

type Platform = 'tiktok' | 'shopee'

function App() {
  const [platform, setPlatform] = useState<Platform | null>(null)

  if (platform === 'tiktok') return <TiktokFlow onBack={() => setPlatform(null)} />
  if (platform === 'shopee') return <ShopeeFlow onBack={() => setPlatform(null)} />

  return (
    <div className="min-h-svh bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center">
      <div className="max-w-md w-full px-6 py-8 flex flex-col items-center text-center">
        <div className="bg-white rounded-2xl px-6 py-3 shadow-sm border border-neutral-200 mb-3">
          <img src="/logo_luno.png" alt="LUNO" className="h-9 w-auto" />
        </div>
        <p className="text-sm text-neutral-500 mb-8">Chọn kênh muốn đăng video hàng loạt</p>

        <div className="grid grid-cols-2 gap-4 w-full">
          <button
            type="button"
            onClick={() => setPlatform('tiktok')}
            className="flex flex-col items-center gap-3 rounded-xl border-2 border-neutral-200 dark:border-neutral-800 p-6 hover:border-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
          >
            <TikTokIcon size={40} />
            <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
              TikTok
            </span>
          </button>

          <button
            type="button"
            onClick={() => setPlatform('shopee')}
            className="flex flex-col items-center gap-3 rounded-xl border-2 border-neutral-200 dark:border-neutral-800 p-6 hover:border-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/30 transition-colors cursor-pointer"
          >
            <ShopeeIcon size={40} />
            <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
              Shopee
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
