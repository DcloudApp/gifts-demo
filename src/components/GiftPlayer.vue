<script setup>
import { GiftAnimationPlayer } from '@/utils/gift-player'
import vapConfig from './vap.json'

const playerRef = ref()
const bigPlayerRef = ref()
const isSimulating = ref(false)
const bigQueueSize = ref(0)
const smallQueueSize = ref(0)
const bigActiveSize = ref(0)
const smallActiveSize = ref(0)
const totalReceived = ref(0)
const logs = ref([])
const smallGiftToasts = ref([])
const smallMaxConcurrent = ref(3)
const smallPlayerElements = new Map()
const pendingSmallGifts = new Map()
const smallGiftSlots = computed(() => {
  return Array.from({ length: smallMaxConcurrent.value }, (_, index) => {
    return smallGiftToasts.value.find(item => item.slotIndex === index) || {
      id: `empty-${index}`,
      empty: true,
      slotIndex: index,
      user: '礼',
      gift: '等待小礼物',
      combo: 0,
    }
  })
})

let giftPlayer
let simulateTimer

const users = ['小鱼', 'Moon', 'Kevin', '安安', 'Echo', 'Luna']
const gifts = [
  {
    name: '官方 VAP 大礼物',
    url: '/gifts/vap/vap.mp4',
    type: 'vap',
    size: 'big',
    config: vapConfig,
  },
  {
    name: 'SVGA 小礼物',
    url: '/gifts/svga/1.svga',
    type: 'svga',
    size: 'small',
  },
  {
    name: 'SVGA 小礼物',
    url: '/gifts/svga/3.svga',
    type: 'svga',
    size: 'small',
  },
  {
    name: 'SVGA 小礼物',
    url: '/gifts/svga/4.svga',
    type: 'svga',
    size: 'small',
  },
  // {
  //   name: 'SVGA 大礼物',
  //   url: '/gifts/svga/2.svga',
  //   type: 'svga',
  //   size: 'big',
  // },
  // {
  //   name: 'Lottie 大礼物',
  //   url: 'https://assets10.lottiefiles.com/packages/lf20_tzjfwgud.json',
  //   type: 'lottie',
  //   size: 'big',
  // },
]

function syncState() {
  bigQueueSize.value = giftPlayer?.getQueue('big').length || 0
  smallQueueSize.value = giftPlayer?.getQueue('small').length || 0
  bigActiveSize.value = giftPlayer?.getActive('big').length || 0
  smallActiveSize.value = giftPlayer?.getActive('small').length || 0
}

function pushLog(text) {
  logs.value.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text,
    time: new Date().toLocaleTimeString(),
  })
  logs.value = logs.value.slice(0, 8)
}

function showGiftToast(event) {
  if (event.size !== 'small')
    return undefined

  const toastKey = getSmallToastKey(event)
  const currentToast = smallGiftToasts.value.find(item => item.id === toastKey)

  if (currentToast) {
    smallGiftToasts.value = smallGiftToasts.value.map((item) => {
      if (item.id !== toastKey)
        return item

      return {
        ...item,
        combo: Math.max(item.combo, event.combo),
        activeIds: [...new Set([...item.activeIds, event.id])],
      }
    })

    return toastKey
  }

  const usedSlotIndexes = new Set(smallGiftToasts.value.map(item => item.slotIndex))
  const emptySlotIndex = Array.from({ length: smallMaxConcurrent.value }, (_, index) => index)
    .find(index => !usedSlotIndexes.has(index))
  const oldestToast = smallGiftToasts.value.reduce((oldest, item) => {
    if (!oldest || item.createdAt < oldest.createdAt)
      return item

    return oldest
  }, undefined)
  const slotIndex = emptySlotIndex ?? oldestToast?.slotIndex ?? 0
  const nextToast = {
    id: toastKey,
    user: event.user,
    gift: event.name,
    combo: event.combo,
    size: event.size,
    slotIndex,
    createdAt: Date.now(),
    activeIds: [event.id],
  }

  smallGiftToasts.value = [
    ...smallGiftToasts.value.filter(item => item.slotIndex !== slotIndex),
    nextToast,
  ]

  return toastKey
}

function getSmallToastKey(event) {
  return `${event.user}-${event.name}-${event.size}`
}

function setSmallPlayerRef(toastId, element) {
  if (element) {
    smallPlayerElements.set(toastId, element)
    playPendingSmallGifts(toastId)
  }
  else {
    smallPlayerElements.delete(toastId)
  }
}

function playPendingSmallGifts(toastId) {
  const element = smallPlayerElements.get(toastId)

  if (!element || !giftPlayer)
    return

  Array.from(pendingSmallGifts.entries()).forEach(([giftId, pending]) => {
    if (pending.toastId !== toastId)
      return

    pendingSmallGifts.delete(giftId)
    giftPlayer.play({
      ...pending.gift,
      playContainer: element,
    })
  })
}

function removeGiftToast(gift) {
  smallGiftToasts.value = smallGiftToasts.value
    .map((item) => {
      return {
        ...item,
        activeIds: item.activeIds.filter(id => id !== gift.id),
      }
    })
    .filter(item => item.activeIds.length > 0)
}

function createGiftEvent() {
  const gift = gifts[Math.floor(Math.random() * gifts.length)]
  const user = users[Math.floor(Math.random() * users.length)]
  const combo = Math.ceil(Math.random() * 5)

  return {
    id: `${gift.type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    src: gift.url,
    type: gift.type,
    size: gift.size,
    config: gift.config,
    name: gift.name,
    user,
    combo,
    loop: false,
    dynamicObjects: {
      texts: {
        textUser: user,
        textAnchor: `x${combo}`,
      },
    },
    mixins: {
      textUser: user,
      textAnchor: `x${combo}`,
    },
  }
}

function receiveGift() {
  if (!giftPlayer)
    return

  const event = createGiftEvent()

  if (event.size === 'small') {
    const toastId = showGiftToast(event)
    pendingSmallGifts.set(event.id, { gift: event, toastId })
    nextTick(() => playPendingSmallGifts(toastId))
  }
  else {
    giftPlayer.play(event)
  }

  totalReceived.value += 1
  pushLog(`${event.user} 送出${event.size === 'big' ? '大' : '小'}礼物 ${event.name} x${event.combo}`)
  syncState()
}

function receiveBurst() {
  Array.from({ length: 6 }).forEach((_, index) => {
    window.setTimeout(receiveGift, index * 120)
  })
}

function startSimulation() {
  if (simulateTimer)
    return

  isSimulating.value = true
  receiveGift()
  simulateTimer = window.setInterval(receiveGift, 650)
}

function stopSimulation() {
  window.clearInterval(simulateTimer)
  simulateTimer = undefined
  isSimulating.value = false
}

function clearAll() {
  stopSimulation()
  giftPlayer?.clear()
  logs.value = []
  smallGiftToasts.value = []
  smallPlayerElements.clear()
  pendingSmallGifts.clear()
  totalReceived.value = 0
  syncState()
}

function updateSmallMaxConcurrent(count) {
  smallMaxConcurrent.value = Math.max(1, Math.min(3, count))
  smallGiftToasts.value = smallGiftToasts.value.filter(item => item.slotIndex < smallMaxConcurrent.value)
  giftPlayer?.setSmallMaxConcurrent(smallMaxConcurrent.value)
  syncState()
}

onMounted(() => {
  giftPlayer = new GiftAnimationPlayer({
    container: playerRef.value,
    containers: {
      big: bigPlayerRef.value,
    },
    maxConcurrent: {
      big: 1,
      small: smallMaxConcurrent.value,
    },
    width: 200,
    height: 200,
    smallWidth: 52,
    smallHeight: 52,
    applyContainerStyle: false,
  })

  giftPlayer.on('queued', syncState)
  giftPlayer.on('start', (gift) => {
    pushLog(`${gift.name} 开始播放`)
    syncState()
  })
  giftPlayer.on('ended', (gift) => {
    if (gift.size === 'small')
      removeGiftToast(gift)

    pushLog(`${gift.name} 播放完成`)
    syncState()
  })
  giftPlayer.on('error', ({ gift, error }) => {
    if (gift?.size === 'small')
      removeGiftToast(gift)

    pushLog(`${gift?.name || '礼物'} 播放失败：${error?.message || '未知错误'}`)
    syncState()
  })
})

onBeforeUnmount(() => {
  stopSimulation()
  giftPlayer?.destroy()
})
</script>

<template>
  <section class="grid grid-rows-[minmax(0,1fr)_auto] min-h-[100dvh] min-h-screen touch-manipulation overflow-hidden bg-[#07111f] text-[#f8fafc]">
    <div class="relative min-h-0 overflow-hidden">
      <div class="absolute inset-0 from-[#172554] via-[#0f172a] to-[#020617] bg-gradient-to-br" />
      <div class="absolute inset-0 from-[rgba(2,6,23,0.18)] via-[rgba(2,6,23,0.08)] to-[rgba(2,6,23,0.7)] bg-gradient-to-b" />

      <div ref="playerRef" class="pointer-events-none absolute inset-0 z-2 overflow-hidden">
        <div ref="bigPlayerRef" class="absolute inset-0 h-full w-full overflow-hidden" />
      </div>

      <div class="pointer-events-none absolute bottom-6 left-3 z-5 w-[min(240px,calc(100%_-_24px))]">
        <div class="grid auto-rows-[48px] gap-1.5">
          <div v-for="toast in smallGiftSlots" :key="toast.slotIndex" class="relative h-12 overflow-visible">
            <Transition name="gift-toast">
              <div
                v-if="!toast.empty"
                :key="toast.id"
                class="absolute inset-0 box-border flex items-center justify-center gap-1.5 border border-[rgba(251,191,36,0.42)] rounded-full from-[rgba(120,53,15,0.9)] to-[rgba(15,23,42,0.42)] bg-gradient-to-r p-[5px_10px_5px_5px] shadow-[0_14px_34px_rgba(0,0,0,0.28)]"
              >
                <div class="grid h-7.5 w-7.5 flex-none place-items-center rounded-full from-[#f97316] to-[#ec4899] bg-gradient-to-br text-white font-800">
                  {{ toast.user.slice(0, 1) }}
                </div>
                <div class="grid min-w-0">
                  <strong class="overflow-hidden text-ellipsis whitespace-nowrap text-3 text-white font-700">{{ toast.user }}</strong>
                  <span class="overflow-hidden text-ellipsis whitespace-nowrap text-2.75 text-[#fde68a]">送出 {{ toast.gift }}</span>
                </div>
                <div
                  :ref="element => setSmallPlayerRef(toast.id, element)"
                  class="relative h-10.5 w-10.5 overflow-visible"
                />
                <em class="text-4.25 text-white font-900 italic">x{{ toast.combo }}</em>
              </div>
            </Transition>
          </div>
        </div>
      </div>
    </div>

    <div class="relative z-3 box-border border-t border-[rgba(148,163,184,0.28)] bg-[rgba(7,12,22,0.96)] p-[14px_12px_calc(14px+env(safe-area-inset-bottom))] shadow-[0_-18px_50px_rgba(0,0,0,0.3)] max-[380px]:p-[12px_8px_calc(12px+env(safe-area-inset-bottom))]">
      <div class="grid grid-cols-3 mb-3 gap-1.5 max-[380px]:grid-cols-3">
        <span class="grid min-h-13.5 gap-1 border border-[rgba(148,163,184,0.22)] rounded-2 bg-[rgba(15,23,42,0.68)] p-2 text-2.75 text-[#cbd5e1] leading-tight">
          <strong class="text-5 text-white">{{ totalReceived }}</strong>
          收礼
        </span>
        <span class="grid min-h-13.5 gap-1 border border-[rgba(148,163,184,0.22)] rounded-2 bg-[rgba(15,23,42,0.68)] p-2 text-2.75 text-[#cbd5e1] leading-tight">
          <strong class="text-5 text-white">{{ bigQueueSize }}</strong>
          大排队
        </span>
        <span class="grid min-h-13.5 gap-1 border border-[rgba(148,163,184,0.22)] rounded-2 bg-[rgba(15,23,42,0.68)] p-2 text-2.75 text-[#cbd5e1] leading-tight">
          <strong class="text-5 text-white">{{ smallQueueSize }}</strong>
          小排队
        </span>
      </div>

      <div class="grid grid-cols-2 mb-3 gap-2 max-[380px]:grid-cols-2">
        <button v-if="!isSimulating" type="button" class="[-webkit-tap-highlight-color:transparent] min-h-11 border border-[rgba(148,163,184,0.32)] rounded-2 bg-white text-3.25 text-[#0f172a] font-700" @click="startSimulation">
          自动
        </button>
        <button v-else type="button" class="[-webkit-tap-highlight-color:transparent] min-h-11 border border-[rgba(148,163,184,0.32)] rounded-2 bg-white text-3.25 text-[#0f172a] font-700" @click="stopSimulation">
          停止
        </button>
        <button type="button" class="[-webkit-tap-highlight-color:transparent] min-h-11 border border-[rgba(148,163,184,0.32)] rounded-2 bg-white text-3.25 text-[#0f172a] font-700" @click="clearAll">
          清空
        </button>
      </div>

      <div class="grid grid-cols-[minmax(0,1fr)_38px_32px_38px] mb-3 items-center gap-2 text-3 text-[rgba(226,232,240,0.82)]">
        <span>小礼物最大同时播放</span>
        <button type="button" class="[-webkit-tap-highlight-color:transparent] min-h-8.5 border border-[rgba(148,163,184,0.32)] rounded-full bg-white p-0 text-3.25 text-[#0f172a] font-700" @click="updateSmallMaxConcurrent(smallMaxConcurrent - 1)">
          -
        </button>
        <strong class="text-center">{{ smallMaxConcurrent }}</strong>
        <button type="button" class="[-webkit-tap-highlight-color:transparent] min-h-8.5 border border-[rgba(148,163,184,0.32)] rounded-full bg-white p-0 text-3.25 text-[#0f172a] font-700" @click="updateSmallMaxConcurrent(smallMaxConcurrent + 1)">
          +
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.gift-toast-enter-active,
.gift-toast-leave-active {
  transition:
    opacity 0.28s ease,
    transform 0.28s ease;
}

.gift-toast-enter-from {
  opacity: 0;
  transform: translateX(-120%);
}

.gift-toast-leave-to {
  opacity: 0;
  transform: translateX(-120%);
}
</style>
