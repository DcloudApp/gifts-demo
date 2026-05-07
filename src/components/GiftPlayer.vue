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
const smallMaxConcurrent = ref(2)
const smallPlayerElements = new Map()
const pendingSmallGifts = new Map()
const waitingSmallGifts = []
const smallGiftHideTimers = new Map()
const SMALL_GIFT_HIDE_DELAY_MS = 500
const leavingSmallSlots = new Set()
const leavingSmallGifts = new Map()
const receiveBurstTimers = new Set()
const smallGiftSlots = computed(() => {
  return Array.from({ length: smallMaxConcurrent.value }, (_, index) => {
    return smallGiftToasts.value.find(item => item.slotIndex === index) || {
      id: `empty-${index}`,
      empty: true,
      slotIndex: index,
      user: '礼',
      gift: '等待小礼物',
      combo: 0,
      pulseKey: 0,
    }
  })
})

let giftPlayer
let simulateTimer

const users = ['小鱼', 'Moon', 'Kevin', '安安', 'Echo', 'Luna']
const publicAssetUrl = path => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
const gifts = [
  {
    name: '官方 VAP 大礼物',
    url: publicAssetUrl('/gifts/vap/vap.mp4'),
    type: 'vap',
    size: 'big',
    config: vapConfig,
  },
  {
    name: 'SVGA 小礼物',
    url: publicAssetUrl('/gifts/svga/1.svga'),
    type: 'svga',
    size: 'small',
  },
  {
    name: 'SVGA 小礼物',
    url: publicAssetUrl('/gifts/svga/3.svga'),
    type: 'svga',
    size: 'small',
  },
  {
    name: 'SVGA 小礼物',
    url: publicAssetUrl('/gifts/svga/4.svga'),
    type: 'svga',
    size: 'small',
  },
  {
    name: 'SVGA 大礼物',
    url: publicAssetUrl('/gifts/svga/2.svga'),
    type: 'svga',
    size: 'big',
  },
  {
    name: 'Lottie 大礼物',
    url: 'https://assets10.lottiefiles.com/packages/lf20_tzjfwgud.json',
    type: 'lottie',
    size: 'big',
  },
]

function syncState() {
  bigQueueSize.value = giftPlayer?.getQueue('big').length || 0
  smallQueueSize.value = (giftPlayer?.getQueue('small').length || 0) + waitingSmallGifts.length
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
  const usedSlotIndexes = new Set(smallGiftToasts.value.map(item => item.slotIndex))
  const emptySlotIndex = Array.from({ length: smallMaxConcurrent.value }, (_, index) => index)
    .find(index => !usedSlotIndexes.has(index) && !leavingSmallSlots.has(index))
  if (emptySlotIndex === undefined)
    return undefined

  const slotIndex = emptySlotIndex
  const nextToast = {
    id: toastKey,
    user: event.user,
    gift: event.name,
    combo: normalizeGiftCombo(event.combo),
    size: event.size,
    slotIndex,
    createdAt: Date.now(),
    playGiftId: event.id,
    visibleUntil: Date.now() + SMALL_GIFT_HIDE_DELAY_MS,
    pulseKey: 0,
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

function normalizeGiftCombo(combo) {
  return Math.max(1, Number(combo) || 1)
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
      retainAfterEnd: true,
      skipQueueLimit: true,
      playContainer: element,
    })
  })
}

function enqueueSmallGift(event) {
  const combined = combineSmallGift(event)

  if (combined) {
    syncState()
    return
  }

  const toastId = showGiftToast(event)

  if (!toastId) {
    waitingSmallGifts.push(event)
    syncState()
    return
  }

  pendingSmallGifts.set(event.id, { gift: event, toastId })
  nextTick(() => playPendingSmallGifts(toastId))
}

function flushWaitingSmallGifts() {
  while (waitingSmallGifts.length > 0) {
    const event = waitingSmallGifts[0]
    const toastId = showGiftToast(event)

    if (!toastId)
      break

    waitingSmallGifts.shift()
    pendingSmallGifts.set(event.id, { gift: event, toastId })
    nextTick(() => playPendingSmallGifts(toastId))
  }

  syncState()
}

function combineSmallGift(event) {
  const toastKey = getSmallToastKey(event)
  const currentToast = smallGiftToasts.value.find(item => item.id === toastKey)

  if (currentToast) {
    const visibleUntil = Date.now() + SMALL_GIFT_HIDE_DELAY_MS

    smallGiftToasts.value = smallGiftToasts.value.map((item) => {
      if (item.id !== toastKey)
        return item

      return {
        ...item,
        combo: normalizeGiftCombo(item.combo + event.combo),
        visibleUntil,
        pulseKey: item.pulseKey + 1,
      }
    })

    if (smallGiftHideTimers.has(toastKey))
      scheduleSmallGiftHide(toastKey, currentToast.playGiftId)

    return true
  }

  const waitingGift = waitingSmallGifts.find(item => getSmallToastKey(item) === toastKey)

  if (waitingGift) {
    waitingGift.combo = normalizeGiftCombo(waitingGift.combo + event.combo)
    return true
  }

  return false
}

function removeGiftToast(gift) {
  const toastKey = getSmallToastKey(gift)
  const toast = smallGiftToasts.value.find(item => item.id === toastKey && item.playGiftId === gift.id)

  if (!toast)
    return

  const visibleUntil = Math.max(toast.visibleUntil || 0, Date.now() + SMALL_GIFT_HIDE_DELAY_MS)

  smallGiftToasts.value = smallGiftToasts.value.map((item) => {
    if (item.id !== toastKey || item.playGiftId !== gift.id)
      return item

    return {
      ...item,
      visibleUntil,
    }
  })

  scheduleSmallGiftHide(toastKey, gift.id)
}

function scheduleSmallGiftHide(toastKey, giftId) {
  const toast = smallGiftToasts.value.find(item => item.id === toastKey && item.playGiftId === giftId)

  if (!toast)
    return

  window.clearTimeout(smallGiftHideTimers.get(toastKey))

  const delay = Math.max(0, (toast.visibleUntil || Date.now()) - Date.now())
  const timer = window.setTimeout(() => {
    smallGiftHideTimers.delete(toastKey)
    removeEndedGiftToast(toastKey, giftId)
  }, delay)

  smallGiftHideTimers.set(toastKey, timer)
}

function removeEndedGiftToast(toastKey, giftId) {
  const leavingSlotIndexes = smallGiftToasts.value
    .filter(item => item.id === toastKey && item.playGiftId === giftId)
    .map(item => item.slotIndex)

  leavingSlotIndexes.forEach((slotIndex) => {
    leavingSmallSlots.add(slotIndex)
    leavingSmallGifts.set(slotIndex, giftId)
  })

  smallGiftToasts.value = smallGiftToasts.value
    .filter(item => item.id !== toastKey || item.playGiftId !== giftId)

  if (leavingSlotIndexes.length === 0) {
    recycleSmallGiftAnimation(giftId)
    nextTick(flushWaitingSmallGifts)
  }
}

function recycleSmallGiftAnimation(giftId) {
  giftPlayer?.stop(giftId)
}

function handleSmallGiftAfterLeave(slotIndex) {
  const giftId = leavingSmallGifts.get(slotIndex)

  if (giftId)
    recycleSmallGiftAnimation(giftId)

  leavingSmallGifts.delete(slotIndex)
  leavingSmallSlots.delete(slotIndex)
  flushWaitingSmallGifts()
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
    enqueueSmallGift(event)
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
    setTrackedTimeout(receiveBurstTimers, receiveGift, index * 120)
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
  clearTrackedTimeouts(receiveBurstTimers)
  giftPlayer?.clear()
  logs.value = []
  smallGiftToasts.value = []
  smallPlayerElements.clear()
  pendingSmallGifts.clear()
  waitingSmallGifts.length = 0
  leavingSmallSlots.clear()
  leavingSmallGifts.clear()
  smallGiftHideTimers.forEach(timer => window.clearTimeout(timer))
  smallGiftHideTimers.clear()
  totalReceived.value = 0
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

  giftPlayer.preload(gifts.filter(gift => gift.size === 'small')).catch((error) => {
    pushLog(`小礼物预加载失败：${error?.message || '未知错误'}`)
  })
})

onBeforeUnmount(() => {
  stopSimulation()
  clearTrackedTimeouts(receiveBurstTimers)
  smallGiftHideTimers.forEach(timer => window.clearTimeout(timer))
  leavingSmallSlots.clear()
  leavingSmallGifts.clear()
  giftPlayer?.destroy()
})

function setTrackedTimeout(store, handler, delay) {
  const timer = window.setTimeout(() => {
    store.delete(timer)
    handler()
  }, delay)

  store.add(timer)
  return timer
}

function clearTrackedTimeouts(store) {
  store.forEach(timer => window.clearTimeout(timer))
  store.clear()
}
</script>

<template>
  <section
    class="gift-page h-full min-h-0 touch-manipulation overflow-hidden bg-[#07111f] text-[#f8fafc]"
  >
    <div class="gift-stage relative min-h-0 overflow-hidden">
      <div class="gift-fill absolute from-[#172554] via-[#0f172a] to-[#020617] bg-gradient-to-br" />
      <div class="gift-fill absolute from-[rgba(2,6,23,0.18)] via-[rgba(2,6,23,0.08)] to-[rgba(2,6,23,0.7)] bg-gradient-to-b" />

      <div ref="playerRef" class="gift-fill pointer-events-none absolute z-2 overflow-hidden">
        <div ref="bigPlayerRef" class="gift-fill overflow-hidden" />
      </div>

      <div class="small-gift-panel pointer-events-none absolute z-5">
        <div class="small-gift-list">
          <div v-for="toast in smallGiftSlots" :key="toast.slotIndex" class="small-gift-slot relative overflow-visible">
            <Transition name="gift-toast" @after-leave="handleSmallGiftAfterLeave(toast.slotIndex)">
              <div
                v-if="!toast.empty"
                :key="toast.id"
                class="gift-fill gift-toast-wrap absolute"
              >
                <div class="gift-toast box-border border border-[rgba(251,191,36,0.42)] rounded-full from-[rgba(120,53,15,0.9)] to-[rgba(15,23,42,0.42)] bg-gradient-to-r shadow-[0_14px_34px_rgba(0,0,0,0.28)]">
                  <div class="gift-avatar h-7.5 w-7.5 flex-none rounded-full from-[#f97316] to-[#ec4899] bg-gradient-to-br text-white font-800">
                    {{ toast.user.slice(0, 1) }}
                  </div>
                  <div class="gift-copy min-w-0">
                    <strong class="overflow-hidden text-ellipsis whitespace-nowrap text-3 text-white font-700">{{ toast.user }}</strong>
                    <span class="overflow-hidden text-ellipsis whitespace-nowrap text-2.75 text-[#fde68a]">送出 {{ toast.gift }}</span>
                  </div>
                  <div
                    :ref="element => setSmallPlayerRef(toast.id, element)"
                    class="small-gift-renderer"
                  />
                </div>
                <em class="gift-combo text-white font-900 italic">
                  <span :key="toast.pulseKey" class="combo-pulse inline-block">x{{ toast.combo }}</span>
                </em>
              </div>
            </Transition>
          </div>
        </div>
      </div>
    </div>

    <div class="gift-control-panel relative z-3 box-border border-t border-[rgba(148,163,184,0.28)] bg-[rgba(7,12,22,0.96)] shadow-[0_-18px_50px_rgba(0,0,0,0.3)]">
      <div class="gift-stats mb-3">
        <span class="gift-stat min-h-13.5 border border-[rgba(148,163,184,0.22)] rounded-2 bg-[rgba(15,23,42,0.68)] p-2 text-2.75 text-[#cbd5e1] leading-tight">
          <strong class="text-5 text-white">{{ totalReceived }}</strong>
          收礼
        </span>
        <span class="gift-stat min-h-13.5 border border-[rgba(148,163,184,0.22)] rounded-2 bg-[rgba(15,23,42,0.68)] p-2 text-2.75 text-[#cbd5e1] leading-tight">
          <strong class="text-5 text-white">{{ bigQueueSize }}</strong>
          大排队
        </span>
        <span class="gift-stat min-h-13.5 border border-[rgba(148,163,184,0.22)] rounded-2 bg-[rgba(15,23,42,0.68)] p-2 text-2.75 text-[#cbd5e1] leading-tight">
          <strong class="text-5 text-white">{{ smallQueueSize }}</strong>
          小排队
        </span>
      </div>

      <div class="gift-actions mb-3">
        <button v-if="!isSimulating" type="button" class="[-webkit-tap-highlight-color:transparent] min-h-11 border border-[rgba(148,163,184,0.32)] rounded-2 bg-white text-3.25 text-[#0f172a] font-700" @click="startSimulation">
          自动
        </button>
        <button v-else type="button" class="[-webkit-tap-highlight-color:transparent] min-h-11 border border-[rgba(148,163,184,0.32)] rounded-2 bg-white text-3.25 text-[#0f172a] font-700" @click="stopSimulation">
          停止
        </button>
        <button type="button" class="[-webkit-tap-highlight-color:transparent] min-h-11 border border-[rgba(148,163,184,0.32)] rounded-2 bg-white text-3.25 text-[#0f172a] font-700" @click="clearAll">
          清空
        </button>
        <button type="button" class="[-webkit-tap-highlight-color:transparent] min-h-11 border border-[rgba(148,163,184,0.32)] rounded-2 bg-white text-3.25 text-[#0f172a] font-700" @click="receiveBurst">
          连发
        </button>
      </div>

      <div class="mb-3 text-3 text-[rgba(226,232,240,0.82)]">
        <span>小礼物最大同时播放</span>
        <strong class="">{{ `(${smallMaxConcurrent})` }}</strong>
      </div>
    </div>
  </section>
</template>

<style scoped>
.gift-page {
  display: flex;
  flex-direction: column;
}

.gift-stage {
  flex: 1 1 auto;
}

.gift-fill {
  bottom: 0;
  left: 0;
  right: 0;
  top: 0;
}

.small-gift-panel {
  bottom: 24px;
  left: 12px;
  max-width: calc(100% - 24px);
  right: 12px;
  width: auto;
}

.small-gift-list {
  display: block;
}

.small-gift-slot {
  height: 48px;
}

.small-gift-slot + .small-gift-slot {
  margin-top: 6px;
}

.gift-toast-wrap {
  align-items: center;
  display: inline-flex;
  max-width: 100%;
  right: auto;
}

.gift-toast {
  align-items: center;
  display: flex;
  height: 100%;
  justify-content: center;
  padding: 5px 8px 5px 5px;
}

.gift-avatar {
  align-items: center;
  display: flex;
  justify-content: center;
}

.gift-copy {
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  margin-left: 6px;
  max-width: 90px;
}

.small-gift-renderer {
  flex: 0 0 auto;
  height: 42px;
  margin-left: 5px;
  overflow: visible;
  position: relative;
  width: 42px;
}

.gift-combo {
  flex: 0 0 auto;
  font-size: 16px;
  line-height: 1;
  margin-left: 8px;
  white-space: nowrap;
}

.gift-control-panel {
  flex: 0 0 auto;
  padding: 14px 12px 14px;
}

.gift-stats,
.gift-actions {
  display: flex;
}

.gift-stat,
.gift-actions > button {
  flex: 1 1 0;
  min-width: 0;
}

.gift-stat {
  display: flex;
  flex-direction: column;
}

.gift-stat + .gift-stat {
  margin-left: 6px;
}

.gift-actions > button + button {
  margin-left: 8px;
}

@supports (padding-bottom: env(safe-area-inset-bottom)) {
  .gift-control-panel {
    padding-bottom: calc(14px + env(safe-area-inset-bottom));
  }
}

@media (max-width: 380px) {
  .gift-control-panel {
    padding: 12px 8px 12px;
  }

  @supports (padding-bottom: env(safe-area-inset-bottom)) {
    .gift-control-panel {
      padding-bottom: calc(12px + env(safe-area-inset-bottom));
    }
  }
}

.gift-toast-enter-active,
.gift-toast-leave-active {
  transition: opacity 0.28s ease;
}

.gift-toast-enter-active {
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
}

.combo-pulse {
  animation: combo-pulse 0.34s ease-out;
}

@keyframes combo-pulse {
  0% {
    transform: scale(1);
  }

  45% {
    transform: scale(1.28);
  }

  100% {
    transform: scale(1);
  }
}
</style>
